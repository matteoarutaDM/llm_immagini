"use client";

import { createContext, useContext, useMemo } from "react";

import { can } from "../../_lib/permissions";

const OperatorContext = createContext(null);

/** Exposes the server-validated operator and a bound `can()` to client components. */
export function OperatorProvider({ operator, children }) {
  const value = useMemo(() => ({ operator, can: (permission) => can(operator.role, permission) }), [operator]);
  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

/** @returns {{ operator: { id: string, email: string, name: string, role: "admin" | "support" }, can: (permission: import("../../_lib/permissions").Permission) => boolean }} */
export function useOperator() {
  const value = useContext(OperatorContext);
  if (!value) throw new Error("useOperator must be used inside <OperatorProvider>");
  return value;
}
