import { WarningIcon } from "./UiIcons";
import styles from "./FieldError.module.css";

export default function FieldError({ message }: { message: string }) {
  return (
    <p className={styles.fieldError} role="alert">
      <WarningIcon size={12} />
      {message}
    </p>
  );
}
