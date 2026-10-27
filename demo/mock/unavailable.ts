import { currentDemoLocale } from "./locale";

/** Message for actions that need a real Brabbler server. */
export function demoOnlyMessage(): string {
  return currentDemoLocale() === "zh"
    ? "这是静态演示，此操作需要真实的 Brabbler 服务。运行 nix run /path/to/brabbler -- --no-open 即可完整体验。"
    : "This is a static demo, so this action needs a real Brabbler server. Run nix run /path/to/brabbler -- --no-open to try it for real.";
}
