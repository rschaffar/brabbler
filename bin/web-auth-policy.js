"use strict";

/** Explicit startup policy, shared by maintained launchers and request admission.
 * Legacy REQUIRE_AUTH=0 does not opt out of the protected default.
 */
function getWebAuthPolicy(env = process.env) {
  const required = env.BRABBLER_REQUIRE_AUTH;
  const disabled = env.BRABBLER_NO_AUTH;
  if ([required, disabled].some(value => value !== undefined && !["", "0", "1"].includes(value))) return "invalid";
  if (disabled === "1") return required === "1" ? "invalid" : "disabled";
  return "required";
}

module.exports = { getWebAuthPolicy };
