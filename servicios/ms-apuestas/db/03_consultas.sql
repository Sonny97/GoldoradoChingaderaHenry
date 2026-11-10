-- =============================================================================
--  goldorado_apuestas · CONSULTAS DE SUSTENTACION · PostgreSQL
--
--  El equivalente del 03_consultas.sql del monolito para la parte que ahora
--  vive en PostgreSQL (Azure). Cada bloque dice que demuestra.
--
--  Se puede correr de punta a punta sin modificar datos:
--    psql -h <host> -U <usuario> -d goldorado_apuestas -f db/03_consultas.sql
--  Las escrituras de demostracion van entre BEGIN ... ROLLBACK, y las
--  violaciones de restricciones dentro de bloques DO que capturan el error y lo
--  muestran como NOTICE con su SQLSTATE (asi el archivo no se detiene).
--
--  Los nombres de equipos y torneos viven en MySQL (ms-deportes): aqui solo
--  hay ids. En la aplicacion el BFF hace ese "JOIN" llamando a los dos servicios.
-- =============================================================================


-- =============================================================================
-- 1. VERIFICACION DEL ESQUEMA
-- =============================================================================

-- 1.1 Tablas del proyecto y cuantas filas tiene cada una (minimo 2 por tabla).
SELECT 'tipo_mercado' AS tabla, count(*) AS filas FROM tipo_mercado
UNION ALL SELECT 'opcion_mercado',   count(*) FROM opcion_mercado
UNION ALL SELECT 'regla_apuesta',    count(*) FROM regla_apuesta
UNION ALL SELECT 'cuota_oferta',     count(*) FROM cuota_oferta
UNION ALL SELECT 'cuenta_saldo',     count(*) FROM cuenta_saldo
UNION ALL SELECT 'apuesta',          count(*) FROM apuesta
UNION ALL SELECT 'movimiento_saldo', count(*) FROM movimiento_saldo
UNION ALL SELECT 'promocion',        count(*) FROM promocion
UNION ALL SELECT 'promocion_torneo', count(*) FROM promocion_torneo
UNION ALL SELECT 'evento_salida',    count(*) FROM evento_salida;

-- 1.2 TODAS las restricciones con nombre, tipo y definicion.
--     pg_get_constraintdef reconstruye el texto tal como lo guardo el motor.
--     PostgreSQL 18 tambien registra los NOT NULL en pg_constraint (contype 'n',
--     nombre automatico): se filtran para ver solo las declaradas.
SELECT c.conrelid::regclass AS tabla,
       c.conname            AS restriccion,
       CASE c.contype
            WHEN 'p' THEN 'PRIMARY KEY'
            WHEN 'f' THEN 'FOREIGN KEY'
            WHEN 'u' THEN 'UNIQUE'
            WHEN 'c' THEN 'CHECK'
       END                  AS tipo,
       pg_get_constraintdef(c.oid) AS definicion
  FROM pg_constraint c
 WHERE c.connamespace = 'public'::regnamespace
   AND c.contype IN ('p', 'f', 'u', 'c')
 ORDER BY c.conrelid::regclass::text, c.contype, c.conname;

-- 1.3 Indices (incluye los PARCIALES: uq_promocion_destacada e ix_evento_salida_pendiente).
SELECT tablename AS tabla, indexname AS indice, indexdef AS definicion
  FROM pg_indexes
 WHERE schemaname = 'public'
 ORDER BY tablename, indexname;

-- 1.4 Columnas IDENTITY y GENERATED (las equivalentes a IDENTITY y PERSISTED del monolito).
SELECT table_name, column_name, is_identity, identity_generation, is_generated, generation_expression
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (is_identity = 'YES' OR is_generated = 'ALWAYS')
 ORDER BY table_name, column_name;


-- =============================================================================
-- 2. ESTADO DE CUENTA (usuario 1)
-- =============================================================================

-- 2.1 La billetera.
SELECT id_usuario, saldo_disponible, saldo_bloqueado,
       saldo_disponible + saldo_bloqueado AS saldo_total, moneda, actualizado_en
  FROM cuenta_saldo
 WHERE id_usuario = 1;

-- 2.2 El diario con saldo ACUMULADO calculado por una funcion de ventana
--     (SUM ... OVER ORDER BY) y comparado con el saldo que se guardo en cada
--     movimiento. Las dos columnas deben coincidir fila por fila.
SELECT m.creado_en,
       m.tipo,
       m.referencia,
       CASE WHEN m.tipo IN ('DEPOSITO', 'PREMIO', 'REEMBOLSO') THEN m.monto ELSE -m.monto END AS valor,
       sum(CASE WHEN m.tipo IN ('DEPOSITO', 'PREMIO', 'REEMBOLSO') THEN m.monto ELSE -m.monto END)
           OVER (PARTITION BY m.id_usuario ORDER BY m.creado_en, m.id_movimiento) AS saldo_calculado,
       m.saldo_disponible_resultante,
       m.proveedor,
       m.metodo
  FROM movimiento_saldo m
 WHERE m.id_usuario = 1
 ORDER BY m.creado_en, m.id_movimiento;


-- =============================================================================
-- 3. APUESTAS CON SU CONTEXTO
--    cuota_fijada (snapshot) junto a la cuota ACTUAL de la oferta: si la cuota
--    se moviera, la apuesta seguiria liquidandose con la fijada.
-- =============================================================================

SELECT a.id_apuesta,
       a.id_usuario,
       a.estado_apuesta,
       co.id_encuentro,           -- el BFF lo convierte en "Millonarios vs Nacional"
       tm.nombre       AS mercado,
       om.seleccion,
       a.monto_apostado,
       a.cuota_fijada,
       co.valor_cuota  AS cuota_actual,
       a.ganancia_potencial,      -- columna GENERATED
       ra.nombre       AS regla,
       a.fecha_apuesta,
       a.id_transaccion           -- codigo del movimiento en MongoDB
  FROM apuesta a
  JOIN cuota_oferta   co ON co.id_cuota   = a.id_cuota
  JOIN opcion_mercado om ON om.id_opcion  = co.id_opcion
  JOIN tipo_mercado   tm ON tm.codigo     = om.codigo_mercado
  JOIN regla_apuesta  ra ON ra.id_regla   = a.id_regla
 ORDER BY a.fecha_apuesta DESC;


-- =============================================================================
-- 4. RESUMEN POR USUARIO CON FILTER (WHERE ...)
--    Es el SUM(CASE WHEN ...) del monolito escrito a la manera de PostgreSQL.
--    NULLIF evita la division por cero (la misma guarda del servicio).
-- =============================================================================

SELECT a.id_usuario,
       count(*)                                                AS total,
       count(*) FILTER (WHERE a.estado_apuesta = 'GANADA')     AS ganadas,
       count(*) FILTER (WHERE a.estado_apuesta = 'PERDIDA')    AS perdidas,
       count(*) FILTER (WHERE a.estado_apuesta = 'PENDIENTE')  AS pendientes,
       sum(a.monto_apostado)                                   AS apostado,
       COALESCE(sum(a.ganancia_potencial) FILTER (WHERE a.estado_apuesta = 'GANADA'), 0) AS retornado,
       COALESCE(round(100 * (COALESCE(sum(a.ganancia_potencial) FILTER (WHERE a.estado_apuesta = 'GANADA'), 0)
                             - sum(a.monto_apostado)) / NULLIF(sum(a.monto_apostado), 0)), 0) AS rendimiento_pct
  FROM apuesta a
 GROUP BY a.id_usuario
 ORDER BY a.id_usuario;


-- =============================================================================
-- 5. FUNCIONES DE VENTANA SOBRE LAS CUOTAS
-- =============================================================================

-- 5.1 La cuota MAS ALTA de cada partido (ROW_NUMBER por particion).
SELECT id_encuentro, codigo_corto, seleccion, valor_cuota
  FROM (SELECT co.id_encuentro, om.codigo_corto, om.seleccion, co.valor_cuota,
               row_number() OVER (PARTITION BY co.id_encuentro
                                  ORDER BY co.valor_cuota DESC, om.orden) AS posicion
          FROM cuota_oferta co
          JOIN opcion_mercado om ON om.id_opcion = co.id_opcion) t
 WHERE posicion = 1
 ORDER BY id_encuentro;

-- 5.2 Lo mismo con DISTINCT ON, una extension propia de PostgreSQL.
SELECT DISTINCT ON (co.id_encuentro)
       co.id_encuentro, om.codigo_corto, om.seleccion, co.valor_cuota
  FROM cuota_oferta co
  JOIN opcion_mercado om ON om.id_opcion = co.id_opcion
 ORDER BY co.id_encuentro, co.valor_cuota DESC, om.orden;

-- 5.3 Cada cuota frente al promedio de su partido y su rango (RANK).
SELECT co.id_encuentro, om.codigo_corto, co.valor_cuota, co.estado,
       round(avg(co.valor_cuota) OVER (PARTITION BY co.id_encuentro), 2)      AS promedio_partido,
       rank() OVER (PARTITION BY co.id_encuentro ORDER BY co.valor_cuota DESC) AS rango
  FROM cuota_oferta co
  JOIN opcion_mercado om ON om.id_opcion = co.id_opcion
 ORDER BY co.id_encuentro, om.orden;


-- =============================================================================
-- 6. LEFT JOIN LATERAL = OUTER APPLY
--    La consulta exacta con la que el servicio valida una apuesta
--    (apuestaRepo.contextoDeCuota). Si un mercado no tuviera regla, la cuota
--    sale igual con la regla en NULL y el servicio da un mensaje claro.
-- =============================================================================

SELECT co.id_cuota, co.valor_cuota, co.estado AS estado_cuota, co.id_encuentro,
       om.seleccion, om.codigo_mercado,
       ra.id_regla, ra.monto_minimo, ra.monto_maximo, ra.nombre AS regla_nombre
  FROM cuota_oferta co
  JOIN opcion_mercado om ON om.id_opcion = co.id_opcion
  LEFT JOIN LATERAL (
       SELECT r.id_regla, r.monto_minimo, r.monto_maximo, r.nombre
         FROM regla_apuesta r
        WHERE r.codigo_mercado = om.codigo_mercado
        ORDER BY r.id_regla
        LIMIT 1
  ) ra ON true
 WHERE co.id_cuota = 1;

-- Las opciones NG / O25 / U25 no tienen cuota publicada: LEFT JOIN normal
-- para ver cuales opciones del catalogo no se ofrecen en ningun partido.
SELECT om.codigo_mercado, om.codigo_corto, om.seleccion, count(co.id_cuota) AS cuotas_publicadas
  FROM opcion_mercado om
  LEFT JOIN cuota_oferta co ON co.id_opcion = om.id_opcion
 GROUP BY om.id_opcion
 ORDER BY om.orden;


-- =============================================================================
-- 7. UNA APUESTA COMPLETA, PASO A PASO (y deshecha con ROLLBACK)
--    Las mismas sentencias del servicio, en el mismo orden, en UNA transaccion.
-- =============================================================================

BEGIN;

-- 7.1 Creacion perezosa de la billetera (no hace nada si ya existe).
INSERT INTO cuenta_saldo (id_usuario) VALUES (1)
ON CONFLICT ON CONSTRAINT pk_cuenta_saldo DO NOTHING;

-- 7.2 Descuento ATOMICO: la condicion del saldo va dentro del UPDATE.
UPDATE cuenta_saldo
   SET saldo_disponible = saldo_disponible - 20000,
       saldo_bloqueado  = saldo_bloqueado  + 20000
 WHERE id_usuario = 1 AND saldo_disponible >= 20000
RETURNING saldo_disponible, saldo_bloqueado;

-- 7.3 La apuesta: ganancia_potencial la calcula el motor.
INSERT INTO apuesta (id_usuario, id_cuota, id_regla, id_transaccion, monto_apostado, cuota_fijada)
VALUES (1, 5, 1, 'aaaaaaaa-0000-4000-8000-000000000001', 20000, 1.67)
RETURNING id_apuesta, ganancia_potencial, fecha_apuesta;

-- 7.4 Diario y 7.5 bandeja de salida, en la misma transaccion.
INSERT INTO movimiento_saldo (id_usuario, tipo, monto, saldo_disponible_resultante, referencia)
VALUES (1, 'APUESTA', 20000, 230000, 'aaaaaaaa-0000-4000-8000-000000000001');

INSERT INTO evento_salida (tipo, carga)
VALUES ('TRANSACCION', '{"codigo": "aaaaaaaa-0000-4000-8000-000000000001", "idUsuario": 1,
                         "tipo": "APUESTA", "estado": "COMPLETADO", "monto": 20000, "moneda": "COP",
                         "origen": "ms-apuestas", "ejecutadoPor": "APUESTA_WEB"}');

-- 7.6 SALDO INSUFICIENTE: Valentina tiene 84.500; pedir 100.000 afecta 0 filas
--     y el servicio responde "Saldo insuficiente". Nada que deshacer a mano.
UPDATE cuenta_saldo
   SET saldo_disponible = saldo_disponible - 100000,
       saldo_bloqueado  = saldo_bloqueado  + 100000
 WHERE id_usuario = 2 AND saldo_disponible >= 100000
RETURNING saldo_disponible;

-- 7.7 BANDEJA DE SALIDA PENDIENTE con FOR UPDATE SKIP LOCKED: la consulta del
--     relevo. Bloquea las filas que toma; otra sesion que corra lo mismo al
--     tiempo SALTA esas filas en vez de esperar (varias instancias no se pisan).
SELECT id_evento, tipo, carga->>'codigo' AS codigo, intentos, creado_en
  FROM evento_salida
 WHERE enviado_en IS NULL
 ORDER BY id_evento
 LIMIT 20
 FOR UPDATE SKIP LOCKED;

ROLLBACK;


-- =============================================================================
-- 8. JSONB: CONSULTAS DENTRO DE evento_salida.carga
-- =============================================================================

-- 8.1 Campos de la carga como columnas (->> devuelve texto; se castea).
SELECT id_evento,
       carga->>'codigo'                   AS codigo,
       (carga->>'idUsuario')::bigint      AS id_usuario,
       (carga->>'monto')::numeric         AS monto,
       carga->>'referenciaExterna'        AS referencia_externa,
       intentos,
       enviado_en
  FROM evento_salida
 ORDER BY id_evento;

-- 8.2 Contencion (@>): eventos de APUESTA del usuario 1, con la carga legible.
SELECT id_evento, jsonb_pretty(carga) AS carga
  FROM evento_salida
 WHERE carga @> '{"tipo": "APUESTA", "idUsuario": 1}';

-- 8.3 Cruce JSONB <-> relacional: cada evento con su apuesta por el UUID.
SELECT e.id_evento, a.id_apuesta, a.monto_apostado,
       (e.carga->>'monto')::numeric = a.monto_apostado AS monto_coincide
  FROM evento_salida e
  JOIN apuesta a ON a.id_transaccion = (e.carga->>'codigo')::uuid
 ORDER BY e.id_evento;

-- 8.4 Que claves traen las cargas (jsonb_object_keys) y cuantas tienen 'fecha' (operador ?).
SELECT DISTINCT jsonb_object_keys(carga) AS clave FROM evento_salida ORDER BY 1;
SELECT count(*) FILTER (WHERE carga ? 'fecha') AS con_fecha, count(*) AS total FROM evento_salida;


-- =============================================================================
-- 9. IDEMPOTENCIA DEL DEPOSITO
--    Es la garantia que permite que el webhook de Wompi y la conciliacion de
--    ms-pagos lleguen los dos sin acreditar dos veces.
-- =============================================================================

-- 9.1 Como lo hace el servicio: ON CONFLICT ... DO NOTHING -> "INSERT 0 0",
--     RETURNING sin filas, y el saldo no se toca (aplicado = false).
BEGIN;
INSERT INTO movimiento_saldo (id_usuario, tipo, monto, saldo_disponible_resultante, referencia, proveedor, metodo)
VALUES (1, 'DEPOSITO', 300000, 550000, 'GD-SEED-0001', 'Wompi', 'NEQUI')
ON CONFLICT ON CONSTRAINT uq_movimiento_saldo_referencia DO NOTHING
RETURNING id_movimiento;
ROLLBACK;

-- 9.2 Sin ON CONFLICT: la base lo rechaza con 23505 (unique_violation).
DO $$
DECLARE
    v_restriccion text;
BEGIN
    INSERT INTO movimiento_saldo (id_usuario, tipo, monto, saldo_disponible_resultante, referencia)
    VALUES (1, 'DEPOSITO', 300000, 550000, 'GD-SEED-0001');
    RAISE NOTICE 'No deberia llegar aqui';
EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    RAISE NOTICE 'Deposito duplicado -> SQLSTATE % en %: %', SQLSTATE, v_restriccion, SQLERRM;
END $$;


-- =============================================================================
-- 10. RESTRICCIONES EN ACCION (cada una con su SQLSTATE)
--     23514 check_violation · 23503 foreign_key_violation
--     23505 unique_violation · 428C9 generated_always
--     Son los codigos que traducirErrorBaseDatos convierte en estados gRPC.
-- =============================================================================

-- 10.1 CHECK 23514: una cuota de 1.00 no es una apuesta.
DO $$
DECLARE v_restriccion text;
BEGIN
    INSERT INTO cuota_oferta (id_encuentro, id_opcion, valor_cuota) VALUES (1, 5, 1.00);
    RAISE NOTICE 'No deberia llegar aqui';
EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    RAISE NOTICE 'Cuota 1.00 -> SQLSTATE % en %: %', SQLSTATE, v_restriccion, SQLERRM;
END $$;

-- 10.2 CHECK 23514: el saldo NUNCA queda negativo, aunque una consulta olvide la condicion.
DO $$
DECLARE v_restriccion text;
BEGIN
    UPDATE cuenta_saldo SET saldo_disponible = saldo_disponible - 1000000 WHERE id_usuario = 2;
    RAISE NOTICE 'No deberia llegar aqui';
EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    RAISE NOTICE 'Saldo negativo -> SQLSTATE % en %: %', SQLSTATE, v_restriccion, SQLERRM;
END $$;

-- 10.3 FK 23503: apuesta a una cuota que no existe.
DO $$
DECLARE v_restriccion text;
BEGIN
    INSERT INTO apuesta (id_usuario, id_cuota, id_regla, id_transaccion, monto_apostado, cuota_fijada)
    VALUES (1, 999999, 1, gen_random_uuid(), 10000, 2.00);
    RAISE NOTICE 'No deberia llegar aqui';
EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    RAISE NOTICE 'Cuota inexistente -> SQLSTATE % en %: %', SQLSTATE, v_restriccion, SQLERRM;
END $$;

-- 10.4 UNIQUE 23505: Goldorado ofrece UNA cuota por opcion y encuentro.
DO $$
DECLARE v_restriccion text;
BEGIN
    INSERT INTO cuota_oferta (id_encuentro, id_opcion, valor_cuota) VALUES (1, 1, 1.90);
    RAISE NOTICE 'No deberia llegar aqui';
EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    RAISE NOTICE 'Cuota repetida -> SQLSTATE % en %: %', SQLSTATE, v_restriccion, SQLERRM;
END $$;

-- 10.5 UNIQUE PARCIAL 23505: solo una promocion destacada.
DO $$
BEGIN
    UPDATE promocion SET destacada = true WHERE id_promocion = 2;
    RAISE NOTICE 'No deberia llegar aqui';
EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'Segunda destacada -> SQLSTATE %: %', SQLSTATE, SQLERRM;
END $$;

-- 10.6 GENERATED 428C9: ganancia_potencial no se escribe, se calcula.
DO $$
BEGIN
    UPDATE apuesta SET ganancia_potencial = 0 WHERE id_apuesta = 1;
    RAISE NOTICE 'No deberia llegar aqui';
EXCEPTION WHEN SQLSTATE '428C9' THEN
    RAISE NOTICE 'Escribir la columna generada -> SQLSTATE %: %', SQLSTATE, SQLERRM;
END $$;

-- 10.7 IDENTITY 428C9: GENERATED ALWAYS no acepta un id a mano sin OVERRIDING SYSTEM VALUE
--      (por eso el archivo de datos lo usa para fijar los ids compartidos).
DO $$
BEGIN
    INSERT INTO promocion (id_promocion, titulo, fecha_expira) VALUES (99, 'Prueba', CURRENT_DATE);
    RAISE NOTICE 'No deberia llegar aqui';
EXCEPTION WHEN SQLSTATE '428C9' THEN
    RAISE NOTICE 'Id manual en IDENTITY -> SQLSTATE %: %', SQLSTATE, SQLERRM;
END $$;


-- =============================================================================
-- 11. PROMOCIONES VIGENTES CON SUS TORNEOS (array_agg)
--     Una fila por promocion con los ids de torneo en un arreglo: el JOIN no
--     la multiplica. FILTER descarta el NULL de las promos sin torneos.
--     GROUP BY la PK permite seleccionar las demas columnas (dependencia funcional).
-- =============================================================================

SELECT p.id_promocion,
       p.titulo,
       p.destacada,
       p.fecha_expira,
       p.fecha_expira - CURRENT_DATE AS dias_restantes,
       COALESCE(array_agg(pt.id_torneo ORDER BY pt.id_torneo)
                FILTER (WHERE pt.id_torneo IS NOT NULL), '{}') AS ids_torneo
  FROM promocion p
  LEFT JOIN promocion_torneo pt ON pt.id_promocion = p.id_promocion
 WHERE p.fecha_expira >= CURRENT_DATE
 GROUP BY p.id_promocion
 ORDER BY p.destacada DESC, p.fecha_expira;

-- Al reves: cuantas promociones vigentes aplican a cada torneo, con sus
-- titulos en una sola celda (string_agg ordenado).
SELECT pt.id_torneo,
       count(*)                                       AS promociones_vigentes,
       string_agg(p.titulo, ', ' ORDER BY p.titulo)   AS titulos
  FROM promocion_torneo pt
  JOIN promocion p ON p.id_promocion = pt.id_promocion
 WHERE p.fecha_expira >= CURRENT_DATE
 GROUP BY pt.id_torneo
 ORDER BY pt.id_torneo;
