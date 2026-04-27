import { redirect } from "next/navigation";

/**
 * Legacy URL · Phase 2 redirected `/employees/design` to the employees list.
 *
 * The design surface split into two pieces:
 *   /employees/new         · hire a brand-new employee
 *   /employees/{id}?tab=config · edit / publish / delete an existing one
 *
 * Anyone following an old bookmark lands on the roster, where they can either
 * pick an existing employee or click "+ New employee".
 */
export default function LegacyEmployeeDesignPage() {
  redirect("/employees");
}
