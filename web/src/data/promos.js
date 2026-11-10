/**
 * ARCHIVO DE REFERENCIA - YA NO SE IMPORTA EN NINGUNA PARTE.
 *
 * Estos datos ahora viven en SQL Server (Promocion y Promocion_Torneo) y llegan
 * por el API. Se conserva porque es la fuente de server/db/02_datos.sql.
 *
 * ---------------------------------------------------------------------------
 * Promociones. Una destacada (la del boceto: "50% descuento") + 5 mas.
 * DashboardPage usa getFeaturedPromo() para el banner y
 * getPromos({ limit: 3, excludeFeatured: true }) para las 3 tarjetas.
 */

export const PROMOS = [
  {
    id: 'p-01',
    featured: true,
    title: '50% descuento',
    subtitle: 'En tu primera recarga',
    description:
      'Duplicamos tu saldo hasta $200.000 en tu primer depósito de la semana. Aplica a todas las ligas.',
    badge: 'Nuevo',
    ctaLabel: 'Ver detalle',
    accent: 'gold',
    expiresAt: '2026-09-30',
  },
  {
    id: 'p-02',
    featured: false,
    title: 'Combinada segura',
    subtitle: 'Hasta 5 selecciones',
    description: 'Si falla solo una de tu combinada, te devolvemos la apuesta en saldo bono.',
    badge: 'Popular',
    ctaLabel: 'Ver detalle',
    accent: 'emerald',
    expiresAt: '2026-10-15',
  },
  {
    id: 'p-03',
    featured: false,
    title: 'Cuota mejorada',
    subtitle: 'Clásicos del fin de semana',
    description: 'Elevamos la cuota del marcador exacto en los cinco clásicos de la jornada.',
    badge: 'Fin de semana',
    ctaLabel: 'Ver detalle',
    accent: 'violet',
    expiresAt: '2026-09-08',
  },
  {
    id: 'p-04',
    featured: false,
    title: 'Bono E-Fútbol',
    subtitle: '$50.000 sin depósito',
    description: 'Estrena la sección de E-Fútbol y llévate saldo para tus primeras cinco apuestas.',
    badge: 'E-Fútbol',
    ctaLabel: 'Ver detalle',
    accent: 'crimson',
    expiresAt: '2026-09-22',
  },
  {
    id: 'p-05',
    featured: false,
    title: 'Retiro exprés',
    subtitle: 'Menos de 5 minutos',
    description: 'Verifica tu cuenta y recibe tus retiros en menos de cinco minutos, sin comisión.',
    badge: 'Siempre activo',
    ctaLabel: 'Ver detalle',
    accent: 'gold',
    expiresAt: '2026-12-31',
  },
  {
    id: 'p-06',
    featured: false,
    title: 'Refiere y gana',
    subtitle: '$30.000 por amigo',
    description: 'Por cada amigo que se registre y haga su primera recarga, ambos reciben saldo.',
    badge: 'Amigos',
    ctaLabel: 'Ver detalle',
    accent: 'emerald',
    expiresAt: '2026-11-30',
  },
];
