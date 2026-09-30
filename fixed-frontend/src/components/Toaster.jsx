import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle, Info, X } from "lucide-react";

const listeners = new Set();
const recentMessages = new Map();
const DUPLICATE_WINDOW_MS = 1_000;

const normalizeMessage = (error, fallbackMessage = "An unexpected error occurred.") => {
  if (typeof error === "string") return error.trim() || fallbackMessage;
  if (error?.message && typeof error.message === "string") return error.message;
  return fallbackMessage;
};

export const showToast = (messageOrError, type = "error", fallbackMessage) => {
  const message = normalizeMessage(messageOrError, fallbackMessage);
  const now = Date.now();
  const key = `${type}:${message}`;
  const lastShownAt = recentMessages.get(key);

  // A request error may be reported by both Axios and its caller. Keep it to
  // one notification while still allowing the user to see later occurrences.
  if (lastShownAt && now - lastShownAt < DUPLICATE_WINDOW_MS) return;

  recentMessages.set(key, now);
  listeners.forEach((listener) => listener({ id: `${now}-${Math.random()}`, message, type }));
};

export const showErrorToast = (error, fallbackMessage) => showToast(error, "error", fallbackMessage);
export const showSuccessToast = (message) => showToast(message, "success");
export const showInfoToast = (message) => showToast(message, "info");

/**
 * Drop-in replacement for useState when the state represents an error message.
 * Clearing the error remains silent; every non-empty error is also toasted.
 */
export const useErrorState = (initialValue = "") => {
  const [error, setErrorState] = useState(initialValue);

  useEffect(() => {
    if (error) showErrorToast(error);
  }, [error]);

  return [error, setErrorState];
};

function ErrorToast({ toast, onDismiss }) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(toast.id), 6_000);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.id]);

  const styles = {
    error: {
      icon: <AlertCircle className="mt-0.5 shrink-0 text-red-600" size={20} aria-hidden="true" />,
      container: "border-red-200 text-red-800",
      button: "text-red-500 hover:bg-red-50 hover:text-red-700 focus:ring-red-400",
    },
    success: {
      icon: <CheckCircle className="mt-0.5 shrink-0 text-emerald-600" size={20} aria-hidden="true" />,
      container: "border-emerald-200 text-emerald-800",
      button: "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800 focus:ring-emerald-400",
    },
    info: {
      icon: <Info className="mt-0.5 shrink-0 text-blue-600" size={20} aria-hidden="true" />,
      container: "border-blue-200 text-blue-800",
      button: "text-blue-600 hover:bg-blue-50 hover:text-blue-800 focus:ring-blue-400",
    },
  }[toast.type] || {};

  return (
    <div
      role="alert"
      className={`pointer-events-auto flex w-full items-start gap-3 rounded-2xl border bg-white p-4 text-sm shadow-xl shadow-black/10 ${styles.container}`}
    >
      {styles.icon}
      <p className="min-w-0 flex-1 font-medium leading-5">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className={`-mr-1 -mt-1 rounded-lg p-1 transition-colors focus:outline-none focus:ring-2 ${styles.button}`}
        aria-label="Dismiss error notification"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function Toaster() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const addToast = (toast) => setToasts((currentToasts) => [...currentToasts, toast]);
    listeners.add(addToast);
    return () => listeners.delete(addToast);
  }, []);

  const dismissToast = useCallback((toastId) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  }, []);

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3 sm:right-6 sm:top-6"
      aria-live="assertive"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <ErrorToast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
