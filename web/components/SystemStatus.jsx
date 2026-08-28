import React, {
  useEffect,
  useState
} from "react";

import {
  getHealth
} from "../lib/api";

export default function SystemStatus() {
  const [
    status,
    setStatus
  ] = useState(
    "checking"
  );

  useEffect(() => {
    let mounted = true;

    getHealth()
      .then(() => {
        if (mounted) {
          setStatus("online");
        }
      })
      .catch(() => {
        if (mounted) {
          setStatus("offline");
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const label =
    status === "online"
      ? "API online"
      : status === "checking"
        ? "Connecting..."
        : "API offline";

  return (
    <div className="system-status">
      <span
        className={
          status === "online"
            ? "status-dot online"
            : "status-dot"
        }
      />

      {label}
    </div>
  );
}
