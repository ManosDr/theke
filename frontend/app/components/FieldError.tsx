import styles from "./FieldError.module.css";

export default function FieldError({ message }: { message: string }) {
  return (
    <p className={styles.fieldError} role="alert">
      ⚠ {message}
    </p>
  );
}
