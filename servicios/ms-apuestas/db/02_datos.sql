-- =============================================================================
--  goldorado_apuestas · DATOS SEMILLA · PostgreSQL
--
--  Los mismos datos del monolito (server/db/02_datos.sql), con una diferencia
--  que conviene explicar en la sustentacion: como las referencias entre bases
--  son por id (sin FK posible), los ids se FIJAN explicitamente. El encuentro 1
--  de MySQL, el usuario 1 de SQL Server y el torneo 1 tienen que ser los mismos
--  en todas las bases (CONVENCIONES §5).
--
--  Con GENERATED ALWAYS AS IDENTITY, fijar un id exige OVERRIDING SYSTEM VALUE
--  y luego mover la secuencia (setval) para que el siguiente INSERT normal no
--  choque con la PK.
--
--  Las fechas son RELATIVAS al momento en que se corre (now(), CURRENT_DATE):
--  la demo nunca muestra promociones vencidas.
--
--  Re-ejecutable: TRUNCATE ... RESTART IDENTITY al comienzo. Todo va en UNA
--  transaccion: si la verificacion final falla, no queda nada a medias.
--  Uso: psql -d goldorado_apuestas -f db/02_datos.sql   (o npm run db:setup)
-- =============================================================================

BEGIN;

TRUNCATE evento_salida, promocion_torneo, promocion, movimiento_saldo, apuesta,
         cuenta_saldo, cuota_oferta, regla_apuesta, opcion_mercado, tipo_mercado
RESTART IDENTITY CASCADE;

-- =============================================================================
-- 1. MERCADOS, OPCIONES Y REGLAS
-- =============================================================================

INSERT INTO tipo_mercado (codigo, nombre, descripcion) VALUES
    ('1X2',          'Resultado 1X2',        'Gana el local, empate o gana el visitante'),
    ('AMBOS_ANOTAN', 'Ambos equipos anotan', 'Los dos equipos marcan al menos un gol'),
    ('OVER_UNDER',   'Más/Menos goles',      'Total de goles por encima o por debajo de una línea');

-- codigo_corto es lo que se pinta en el chip de la franja de cuotas.
-- orden define en que posicion aparece.
INSERT INTO opcion_mercado (id_opcion, codigo_mercado, codigo_corto, seleccion, orden)
OVERRIDING SYSTEM VALUE VALUES
    (1, '1X2',          '1',   'Local',        1),
    (2, '1X2',          'X',   'Empate',       2),
    (3, '1X2',          '2',   'Visita',       3),
    (4, 'AMBOS_ANOTAN', 'GG',  'Ambos',        4),
    (5, 'AMBOS_ANOTAN', 'NG',  'No ambos',     5),
    (6, 'OVER_UNDER',   'O25', 'Más de 2.5',   6),
    (7, 'OVER_UNDER',   'U25', 'Menos de 2.5', 7);

INSERT INTO regla_apuesta (id_regla, codigo_mercado, nombre, monto_minimo, monto_maximo, descripcion)
OVERRIDING SYSTEM VALUE VALUES
    (1, '1X2',          'Apuesta simple 1X2',    5000.00, 5000000.00, 'Límite estándar para el mercado de resultado'),
    (2, 'AMBOS_ANOTAN', 'Ambos anotan estándar', 5000.00, 2000000.00, 'Mercado con menos liquidez, tope más bajo'),
    (3, 'OVER_UNDER',   'Más/Menos estándar',    5000.00, 2000000.00, 'Total de goles sobre o bajo la línea');

-- =============================================================================
-- 2. CUOTAS
--
--  4 opciones por encuentro (1, X, 2, GG) x 12 encuentros = 48 cuotas, con los
--  valores de #PartidoRaw del monolito (fracciones del mock convertidas con
--  1 + a/b). Las de los partidos ya jugados (9..12) quedan CERRADO: no se puede
--  apostar a un resultado que ya se conoce.
--
--  id_cuota = (id_encuentro - 1) * 4 + orden  ->  encuentro 1: 1..4, encuentro 5: 17..20
--  CROSS JOIN LATERAL (VALUES ...) es el CROSS APPLY (VALUES ...) del monolito:
--  convierte las 4 columnas de cuota de cada partido en 4 filas.
-- =============================================================================

INSERT INTO cuota_oferta (id_cuota, id_encuentro, id_opcion, valor_cuota, estado)
OVERRIDING SYSTEM VALUE
SELECT (p.id_encuentro - 1) * 4 + o.orden,
       p.id_encuentro,
       o.id_opcion,
       c.valor,
       CASE WHEN p.estado = 'finished' THEN 'CERRADO' ELSE 'ABIERTO' END
  FROM (VALUES
        -- id  mock    estado      1     X     2     GG
        ( 1, 'm-01', 'live',     2.00, 1.60, 1.50, 1.40),   -- MIL - NAL
        ( 2, 'm-02', 'live',     1.67, 1.75, 1.33, 1.50),   -- BOC - FLA
        ( 3, 'm-03', 'live',     1.50, 1.40, 2.50, 1.25),   -- MCI - LIV
        ( 4, 'm-04', 'live',     1.40, 1.60, 1.67, 1.33),   -- RMA - BAR
        ( 5, 'm-05', 'upcoming', 2.00, 1.40, 1.50, 1.60),   -- AME - JUN
        ( 6, 'm-06', 'upcoming', 1.75, 1.40, 1.50, 1.67),   -- RIV - PAL
        ( 7, 'm-07', 'upcoming', 1.67, 1.60, 2.00, 1.50),   -- ARS - CHE
        ( 8, 'm-08', 'upcoming', 1.50, 1.40, 1.75, 1.40),   -- ATM - SEV
        ( 9, 'm-09', 'finished', 2.00, 1.60, 1.40, 1.50),   -- NAL - AME
        (10, 'm-10', 'finished', 1.67, 1.40, 1.50, 1.33),   -- PAL - BOC
        (11, 'm-11', 'finished', 2.50, 1.40, 1.33, 1.50),   -- CHE - MCI
        (12, 'm-12', 'finished', 1.50, 1.60, 1.67, 1.40)    -- BAR - ATM
       ) AS p(id_encuentro, codigo, estado, cuota_1, cuota_x, cuota_2, cuota_gg)
 CROSS JOIN LATERAL (VALUES
        ('1X2',          '1',  p.cuota_1),
        ('1X2',          'X',  p.cuota_x),
        ('1X2',          '2',  p.cuota_2),
        ('AMBOS_ANOTAN', 'GG', p.cuota_gg)
       ) AS c(mercado, corto, valor)
  JOIN opcion_mercado o ON o.codigo_mercado = c.mercado AND o.codigo_corto = c.corto
 ORDER BY 1;

-- =============================================================================
-- 3. BILLETERAS (usuarios 1 y 2 de ms-autenticacion)
--
--  Los saldos son el resultado de los movimientos de la seccion 5:
--  Camilo    (1) deposito 300.000 y aposto 50.000 -> 250.000 disponible, 50.000 bloqueado
--  Valentina (2) deposito 100.000 y aposto 15.500 ->  84.500 disponible, 15.500 bloqueado
-- =============================================================================

INSERT INTO cuenta_saldo (id_usuario, saldo_disponible, saldo_bloqueado, moneda, creado_en) VALUES
    (1, 250000.00, 50000.00, 'COP', now() - interval '3 days'),
    (2,  84500.00, 15500.00, 'COP', now() - interval '2 days');

-- =============================================================================
-- 4. APUESTAS
--
--  cuota_fijada es el SNAPSHOT del momento en que se aposto, no un JOIN vivo a
--  cuota_oferta: si mañana la cuota del Millonarios-Nacional baja a 1.80, esta
--  apuesta sigue liquidandose a 2.00. ganancia_potencial NO se inserta: es una
--  columna GENERATED ... STORED.
--  id_transaccion: los UUID fijos que tambien usa el seed de MongoDB.
--  Dos INSERT separados para que id_apuesta salga 1 y 2 en este orden.
-- =============================================================================

-- Camilo: 50.000 a "Local" del encuentro 1 (en vivo), 5 minutos despues del pitazo.
INSERT INTO apuesta (id_usuario, id_cuota, id_regla, id_transaccion, estado_apuesta,
                     monto_apostado, cuota_fijada, fecha_apuesta)
SELECT 1, co.id_cuota, r.id_regla, 'b3a1c0de-0001-4a00-9000-000000000001'::uuid, 'PENDIENTE',
       50000.00, co.valor_cuota, now() - interval '62 minutes'
  FROM cuota_oferta co
  JOIN opcion_mercado om ON om.id_opcion = co.id_opcion
  JOIN regla_apuesta  r  ON r.nombre = 'Apuesta simple 1X2'
 WHERE co.id_encuentro = 1 AND om.codigo_corto = '1';

-- Valentina: 15.500 a "Ambos" del encuentro 5 (proximo).
INSERT INTO apuesta (id_usuario, id_cuota, id_regla, id_transaccion, estado_apuesta,
                     monto_apostado, cuota_fijada, fecha_apuesta)
SELECT 2, co.id_cuota, r.id_regla, 'b3a1c0de-0002-4a00-9000-000000000002'::uuid, 'PENDIENTE',
       15500.00, co.valor_cuota, now() - interval '2 hours'
  FROM cuota_oferta co
  JOIN opcion_mercado om ON om.id_opcion = co.id_opcion
  JOIN regla_apuesta  r  ON r.nombre = 'Ambos anotan estándar'
 WHERE co.id_encuentro = 5 AND om.codigo_corto = 'GG';

-- =============================================================================
-- 5. DIARIO DE LA BILLETERA
--
--  monto siempre positivo: el signo lo da el tipo. Un deposito lleva proveedor
--  y metodo (entro dinero de afuera); una apuesta es un movimiento interno.
--  referencia: la del pago (GD-SEED-000x, igual que en Firestore y Mongo) o el
--  UUID de la apuesta.
-- =============================================================================

INSERT INTO movimiento_saldo (id_usuario, tipo, monto, saldo_disponible_resultante, referencia,
                              proveedor, metodo, id_transaccion_pasarela, creado_en) VALUES
    (1, 'DEPOSITO', 300000.00, 300000.00, 'GD-SEED-0001',
        'Wompi', 'NEQUI', 'WOMPI-SEED-0001', now() - interval '2 days'),
    (1, 'APUESTA',   50000.00, 250000.00, 'b3a1c0de-0001-4a00-9000-000000000001',
        NULL, NULL, NULL, now() - interval '62 minutes'),
    (2, 'DEPOSITO', 100000.00, 100000.00, 'GD-SEED-0002',
        'Wompi', 'PSE', 'WOMPI-SEED-0002', now() - interval '1 day'),
    (2, 'APUESTA',   15500.00,  84500.00, 'b3a1c0de-0002-4a00-9000-000000000002',
        NULL, NULL, NULL, now() - interval '2 hours');

-- =============================================================================
-- 6. PROMOCIONES (las 6 del monolito, mismos textos; ids 1..6 fijos porque
--    ms-imagenes guarda la imagen de cada una por entidad 'promocion' + id)
--
--  fecha_expira relativa: se conserva el orden de vencimiento del monolito
--  (Cuota mejorada, Bono E-Fútbol, 50%, Combinada, Refiere, Retiro).
-- =============================================================================

INSERT INTO promocion (id_promocion, titulo, subtitulo, descripcion, badge, cta_label, accent, destacada, fecha_expira)
OVERRIDING SYSTEM VALUE VALUES
    (1, '50% descuento',    'En tu primera recarga',      'Duplicamos tu saldo hasta $200.000 en tu primer depósito de la semana. Aplica a todas las ligas.', 'Nuevo',          'Ver detalle', 'gold',    true,  CURRENT_DATE + 60),
    (2, 'Combinada segura', 'Hasta 5 selecciones',        'Si falla solo una de tu combinada, te devolvemos la apuesta en saldo bono.',                        'Popular',        'Ver detalle', 'emerald', false, CURRENT_DATE + 75),
    (3, 'Cuota mejorada',   'Clásicos del fin de semana', 'Elevamos la cuota del marcador exacto en los cinco clásicos de la jornada.',                        'Fin de semana',  'Ver detalle', 'violet',  false, CURRENT_DATE + 30),
    (4, 'Bono E-Fútbol',    '$50.000 sin depósito',       'Estrena la sección de E-Fútbol y llévate saldo para tus primeras cinco apuestas.',                  'E-Fútbol',       'Ver detalle', 'crimson', false, CURRENT_DATE + 45),
    (5, 'Retiro exprés',    'Menos de 5 minutos',         'Verifica tu cuenta y recibe tus retiros en menos de cinco minutos, sin comisión.',                  'Siempre activo', 'Ver detalle', 'gold',    false, CURRENT_DATE + 120),
    (6, 'Refiere y gana',   '$30.000 por amigo',          'Por cada amigo que se registre y haga su primera recarga, ambos reciben saldo.',                    'Amigos',         'Ver detalle', 'emerald', false, CURRENT_DATE + 105);

-- Torneos de MySQL: 1 Liga BetPlay, 2 Copa Libertadores, 3 Premier League, 4 LaLiga.
INSERT INTO promocion_torneo (id_promocion, id_torneo) VALUES
    (1, 1), (1, 2), (1, 3), (1, 4),   -- "50% descuento": aplica a todas las ligas
    (3, 1), (3, 4),                   -- "Cuota mejorada": Liga BetPlay y LaLiga
    (2, 2);                           -- "Combinada segura": Copa Libertadores

-- =============================================================================
-- 7. BANDEJA DE SALIDA: los eventos de las dos apuestas, YA enviados (Mongo
--    tiene esas transacciones en su propio seed). La carga es el
--    RegistrarTransaccionRequest que arma el servicio, en camelCase.
-- =============================================================================

INSERT INTO evento_salida (tipo, carga, creado_en, enviado_en, intentos)
SELECT 'TRANSACCION',
       jsonb_build_object(
           'codigo',            a.id_transaccion::text,
           'idUsuario',         a.id_usuario,
           'tipo',              'APUESTA',
           'estado',            'COMPLETADO',
           'monto',             a.monto_apostado,
           'moneda',            'COP',
           'origen',            'ms-apuestas',
           'referenciaExterna', 'apuesta:' || a.id_apuesta,
           'ejecutadoPor',      'APUESTA_WEB',
           'fecha',             to_char(a.fecha_apuesta AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
       a.fecha_apuesta,
       a.fecha_apuesta + interval '2 seconds',
       1
  FROM apuesta a
 ORDER BY a.id_apuesta;

-- =============================================================================
-- 8. SECUENCIAS: despues de fijar ids a mano, el proximo id automatico debe
--    seguir al mayor (si no, el primer INSERT normal chocaria con la PK).
-- =============================================================================

SELECT setval(pg_get_serial_sequence('opcion_mercado', 'id_opcion'),    (SELECT max(id_opcion)    FROM opcion_mercado));
SELECT setval(pg_get_serial_sequence('regla_apuesta',  'id_regla'),     (SELECT max(id_regla)     FROM regla_apuesta));
SELECT setval(pg_get_serial_sequence('cuota_oferta',   'id_cuota'),     (SELECT max(id_cuota)     FROM cuota_oferta));
SELECT setval(pg_get_serial_sequence('promocion',      'id_promocion'), (SELECT max(id_promocion) FROM promocion));

-- =============================================================================
-- 9. VERIFICACION (regla del taller: minimo 2 filas por tabla) + coherencia
--    del dinero. Si algo falla, RAISE EXCEPTION aborta la transaccion entera.
-- =============================================================================

DO $$
DECLARE
    v_tabla text;
    v_filas bigint;
BEGIN
    FOREACH v_tabla IN ARRAY ARRAY['tipo_mercado', 'opcion_mercado', 'regla_apuesta', 'cuota_oferta',
                                   'cuenta_saldo', 'apuesta', 'movimiento_saldo', 'promocion',
                                   'promocion_torneo', 'evento_salida']
    LOOP
        EXECUTE format('SELECT count(*) FROM %I', v_tabla) INTO v_filas;
        IF v_filas < 2 THEN
            RAISE EXCEPTION 'La tabla % quedo con % fila(s): el taller exige minimo 2', v_tabla, v_filas;
        END IF;
    END LOOP;

    -- El saldo bloqueado de cada billetera es lo comprometido en apuestas PENDIENTE.
    IF EXISTS (
        SELECT 1
          FROM cuenta_saldo cs
          LEFT JOIN apuesta a ON a.id_usuario = cs.id_usuario AND a.estado_apuesta = 'PENDIENTE'
         GROUP BY cs.id_usuario, cs.saldo_bloqueado
        HAVING cs.saldo_bloqueado <> COALESCE(sum(a.monto_apostado), 0)
    ) THEN
        RAISE EXCEPTION 'saldo_bloqueado no coincide con las apuestas pendientes';
    END IF;

    -- El ultimo movimiento del diario deja el saldo disponible actual.
    IF EXISTS (
        SELECT 1
          FROM cuenta_saldo cs
          JOIN LATERAL (
               SELECT m.saldo_disponible_resultante
                 FROM movimiento_saldo m
                WHERE m.id_usuario = cs.id_usuario
                ORDER BY m.creado_en DESC, m.id_movimiento DESC
                LIMIT 1
          ) ultimo ON true
         WHERE ultimo.saldo_disponible_resultante <> cs.saldo_disponible
    ) THEN
        RAISE EXCEPTION 'saldo_disponible no coincide con el diario de movimientos';
    END IF;
END $$;

COMMIT;

-- Resumen para quien corre el archivo (mismo orden de las secciones).
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
