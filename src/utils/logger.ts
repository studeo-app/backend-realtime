export const logger = {
  info: (message: string, metadata?: Record<string, unknown>): void => {
    console.log(
      JSON.stringify({
        level: "info",
        message,
        metadata,
        timestamp: new Date().toISOString()
      })
    );
  },
  warn: (message: string, metadata?: Record<string, unknown>): void => {
    console.warn(
      JSON.stringify({
        level: "warn",
        message,
        metadata,
        timestamp: new Date().toISOString()
      })
    );
  },
  error: (message: string, metadata?: Record<string, unknown>): void => {
    console.error(
      JSON.stringify({
        level: "error",
        message,
        metadata,
        timestamp: new Date().toISOString()
      })
    );
  }
};

