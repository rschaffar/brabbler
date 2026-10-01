type SuccessfulWorkspaceTransition = {
  action: "continue" | "fork";
  destinationPath: string;
};

/** A durable continue receipt stays readable after the chat has moved. Following
 * it again would remount that same chat and repeat the receipt poll indefinitely.
 */
export function shouldFollowWorkspaceTransition(
  transition: SuccessfulWorkspaceTransition,
  currentCwd: string,
): boolean {
  return transition.action !== "continue" || currentCwd !== transition.destinationPath;
}
