export const getErrorMessage = (err, fallbackMessage = "An unexpected error occurred.") => {
  if (!err) return fallbackMessage;

  const detail = err.response?.data?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : "";
          const msg = item.msg || JSON.stringify(item);
          return field && field !== "body" ? `${field}: ${msg}` : msg;
        }
        return String(item);
      })
      .join(", ");
  }

  if (detail && typeof detail === "object") {
    return detail.msg || JSON.stringify(detail);
  }

  if (err.response?.data?.message && typeof err.response.data.message === "string") {
    return err.response.data.message;
  }

  if (err.message && typeof err.message === "string") {
    return err.message;
  }

  return fallbackMessage;
};
