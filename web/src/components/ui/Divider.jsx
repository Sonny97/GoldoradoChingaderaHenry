export default function Divider({ label, gold = false, className = '' }) {
  if (!label) {
    return <hr className={`gd-divider ${gold ? 'gd-divider--gold' : ''} ${className}`.trim()} />;
  }

  return (
    <div className={`gd-divider-label ${className}`.trim()} role="separator">
      <span className="gd-divider-label__line" />
      <span className="gd-divider-label__text">{label}</span>
      <span className="gd-divider-label__line" />
    </div>
  );
}
