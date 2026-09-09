import { Icon, type IconName } from "./Icon";
import styles from "./EmptyState.module.css";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export function EmptyState({
  icon,
  eyebrow,
  title,
  description,
  steps,
  primaryAction,
  secondaryAction,
  compact = false
}: {
  icon: IconName;
  eyebrow: string;
  title: string;
  description: string;
  steps?: string[];
  primaryAction?: EmptyStateAction | undefined;
  secondaryAction?: EmptyStateAction | undefined;
  compact?: boolean;
}) {
  return (
    <div className={`${styles.emptyState} ${compact ? styles.compact : ""}`}>
      <span className={styles.icon}>
        <Icon name={icon} size={compact ? 20 : 24} />
      </span>
      <div className={styles.copy}>
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        <p>{description}</p>
        {steps && steps.length > 0 && (
          <ol>
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
      </div>
      {(primaryAction || secondaryAction) && (
        <div className={styles.actions}>
          {secondaryAction && (
            <button onClick={secondaryAction.onClick} type="button">
              {secondaryAction.label}
            </button>
          )}
          {primaryAction && (
            <button
              className={styles.primaryAction}
              onClick={primaryAction.onClick}
              type="button"
            >
              {primaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
