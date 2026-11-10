import Icon from './icons';

export default function StepIndicator({ steps = [], current = 0 }) {
  return (
    <ol className="gd-steps" aria-label="Progreso">
      {steps.map((label, index) => {
        const done = index < current;
        const isCurrent = index === current;
        return (
          <li
            key={label}
            className={`gd-steps__item ${done ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className="gd-steps__dot">
              {done ? <Icon.Check size={12} /> : index + 1}
            </span>
            <span className="gd-steps__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
