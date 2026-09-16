import {
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type MouseEvent
} from "react";
import { Icon } from "./Icon";
import { localDateInputError } from "../dates/localDateInputValidation";
import styles from "./LocalDateInput.module.css";

type LocalDateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "lang" | "placeholder" | "pattern" | "maxLength"
>;

const LOCAL_DATE_PATTERN = "[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])";

export function LocalDateInput({
  defaultValue,
  disabled,
  max,
  min,
  onBlur,
  onChange,
  onClick,
  readOnly,
  value,
  ...inputProps
}: LocalDateInputProps) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(() => String(defaultValue ?? ""));
  const pickerRef = useRef<HTMLInputElement>(null);
  const displayedValue = controlled ? String(value ?? "") : internalValue;

  const updateValue = (event: ChangeEvent<HTMLInputElement>) => {
    event.target.setCustomValidity(localDateInputError(event.target.value, min, max));
    if (!controlled) setInternalValue(event.target.value);
    onChange?.(event);
  };

  const validateOnBlur = (event: FocusEvent<HTMLInputElement>) => {
    event.target.setCustomValidity(localDateInputError(event.target.value, min, max));
    onBlur?.(event);
  };

  const openPicker = () => {
    const picker = pickerRef.current;
    if (!picker || disabled || readOnly) return;
    picker.value = displayedValue;
    try {
      if (typeof picker.showPicker === "function") picker.showPicker();
      else picker.click();
    } catch {
      picker.focus();
    }
  };

  const handleTextClick = (event: MouseEvent<HTMLInputElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) openPicker();
  };

  return (
    <div className={styles.root}>
      <input
        {...inputProps}
        className={styles.textInput}
        disabled={disabled}
        inputMode="numeric"
        max={max}
        maxLength={10}
        min={min}
        onBlur={validateOnBlur}
        onChange={updateValue}
        onClick={handleTextClick}
        pattern={LOCAL_DATE_PATTERN}
        readOnly={readOnly}
        type="text"
        value={displayedValue}
      />
      {!readOnly && (
        <button
          aria-label="打开日期选择器"
          className={styles.calendarButton}
          disabled={disabled}
          onClick={openPicker}
          type="button"
        >
          <Icon name="calendar" size={17} />
        </button>
      )}
      <input
        aria-hidden="true"
        className={styles.picker}
        disabled={disabled || readOnly}
        max={max}
        min={min}
        onChange={updateValue}
        ref={pickerRef}
        style={{ pointerEvents: "none" }}
        tabIndex={-1}
        type="date"
        value={displayedValue}
      />
    </div>
  );
}
