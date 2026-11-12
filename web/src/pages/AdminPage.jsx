import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAsync } from '../hooks/useAsync';
import * as adminService from '../services/adminService';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import Spinner from '../components/ui/Spinner';
import Icon from '../components/ui/icons';
import AdminMatchRow from '../components/admin/AdminMatchRow';
import { MATCH_STATUS, ROUTES } from '../utils/constants';

/** Orden de los grupos: lo que mas se toca arriba. */
const GROUPS = [
  { status: MATCH_STATUS.LIVE, title: 'En vivo' },
  { status: MATCH_STATUS.UPCOMING, title: 'Próximos' },
  { status: MATCH_STATUS.FINISHED, title: 'Finalizados' },
  { status: MATCH_STATUS.CANCELED, title: 'Cancelados' },
];

/**
 * /admin: panel para mover partidos y liquidar apuestas.
 *
 * ProtectedRoute ya exige sesion; el rol se revisa aqui para mostrar un estado
 * amable en vez de un 403 crudo. El BFF vuelve a revisarlo (requiereRol), asi
 * que esconder la pantalla es comodidad, no seguridad.
 *
 * Los partidos guardados en esta sesion se superponen sobre la lista cargada
 * (`updates`) en vez de recargarla entera: la fila salta a su grupo nuevo al
 * instante y el resultado de la liquidacion (`outcomes`) no se pierde.
 */
export default function AdminPage() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <AdminOnly />;
  return <AdminPanel />;
}

function AdminOnly() {
  return (
    <section className="gd-section gd-container gd-admin">
      <Card padding="lg" className="gd-admin__denied">
        <span className="gd-admin__denied-icon" aria-hidden="true">
          <Icon.Shield size={36} />
        </span>
        <h1 className="gd-section__title">Solo para administradores</h1>
        <p>Esta sección es para el equipo de GolDorado. Tu cuenta no tiene permisos de administración.</p>
        <Button as={Link} to={ROUTES.DASHBOARD} variant="gold">
          Volver al inicio
        </Button>
      </Card>
    </section>
  );
}

function AdminPanel() {
  const fetchMatches = useCallback(() => adminService.getAdminMatches(), []);
  const matches = useAsync(fetchMatches, [], { initialData: [] });

  const [updates, setUpdates] = useState({});
  const [outcomes, setOutcomes] = useState({});

  const handleSaved = useCallback((match, settlement, message) => {
    setUpdates((prev) => ({ ...prev, [match.id]: match }));
    setOutcomes((prev) => ({ ...prev, [match.id]: { settlement, message } }));
  }, []);

  const handleSettled = useCallback((id, settlement) => {
    setOutcomes((prev) => ({ ...prev, [id]: { settlement, message: '' } }));
  }, []);

  const reload = useCallback(() => {
    setUpdates({});
    matches.reload();
  }, [matches]);

  const list = (matches.data ?? []).map((m) => updates[m.id] ?? m);

  return (
    <section className="gd-section gd-container gd-admin">
      <header className="gd-page-head gd-page-head--split">
        <div>
          <span className="gd-eyebrow">
            <span className="gd-eyebrow__dot" />
            Administración
          </span>
          <h1 className="gd-section__title">Partidos y liquidación</h1>
          <p className="gd-admin__lead">
            Cambia el estado, el minuto y el marcador. Al finalizar o cancelar un partido se liquidan sus
            apuestas: se pagan las ganadas y se reembolsan las anuladas.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={matches.isLoading}>
          Actualizar
        </Button>
      </header>

      {matches.isLoading ? (
        <div className="gd-wallet__state">
          <Spinner size={32} label="Cargando partidos" />
        </div>
      ) : matches.error ? (
        <Alert variant="error">{matches.error}</Alert>
      ) : !list.length ? (
        <p className="gd-wallet__empty">No hay partidos cargados.</p>
      ) : (
        <div className="gd-admin__groups">
          {GROUPS.map(({ status, title }) => {
            const group = list.filter((m) => m.status === status);
            if (!group.length) return null;
            return (
              <Card key={status} padding="lg" className="gd-admin__group">
                <header className="gd-wallet__panel-head">
                  <h2 className="gd-wallet__panel-title">
                    {title} <span className="gd-admin__count">{group.length}</span>
                  </h2>
                </header>
                <ul className="gd-admin__list">
                  {group.map((match) => (
                    <AdminMatchRow
                      key={match.id}
                      match={match}
                      outcome={outcomes[match.id]}
                      onSaved={handleSaved}
                      onSettled={handleSettled}
                    />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
