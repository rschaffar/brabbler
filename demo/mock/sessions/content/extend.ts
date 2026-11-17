import { PROJECT_ROOT } from "../../paths";
import { SESSION_IDS } from "../ids";
import type { SessionScript } from "../types";

const STARTED = 3 * 24 * 60 + 40;

const GREP_OUTPUT = `components/SessionSidebar.tsx:169:const RUNNING_SESSIONS_POLL_MS = 2500;
components/SessionSidebar.tsx:596:      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
components/SessionSidebar.tsx:605:        const res = await fetch("/api/agent/running", {
app/api/agent/running/route.ts:10:// GET /api/agent/running - Lightweight snapshot for visible-tab polling.`;

const REPORT = {
  en: `**Running-session polling lives in \`components/SessionSidebar.tsx\`.**

- \`RUNNING_SESSIONS_POLL_MS = 2500\` (line 169) sets the interval.
- The effect around line 590 defines \`poll()\`, which fetches \`GET /api/agent/running\` with \`cache: "no-store"\` and an \`AbortController\`, then schedules the next tick with \`setTimeout\`.
- Polling only runs while \`document.visibilityState === "visible"\`; a \`visibilitychange\` listener pauses it in background tabs and polls again immediately when the tab comes back.
- If the response's \`sessionListVersion\` differs from the last one seen, it reloads the full session list.
- Server side: \`app/api/agent/running/route.ts\` returns \`{ sessionListVersion, runningSessionIds, completionNotificationSuppressedSessionIds }\`.`,
  zh: `**轮询运行中会话的逻辑在 \`components/SessionSidebar.tsx\`。**

- 第 169 行 \`RUNNING_SESSIONS_POLL_MS = 2500\` 定义了轮询间隔。
- 大约第 590 行的 effect 里定义了 \`poll()\`：用 \`cache: "no-store"\` 和 \`AbortController\` 请求 \`GET /api/agent/running\`，再用 \`setTimeout\` 安排下一次。
- 只有 \`document.visibilityState === "visible"\` 时才轮询；\`visibilitychange\` 监听器会在后台标签页暂停轮询，切回来时立即再查一次。
- 如果返回的 \`sessionListVersion\` 和上次不同，就重新加载完整的会话列表。
- 服务端：\`app/api/agent/running/route.ts\` 返回 \`{ sessionListVersion, runningSessionIds, completionNotificationSuppressedSessionIds }\`。`,
};

const TASK = {
  en: "Find where the Brabbler sidebar polls for running sessions: the interval, the endpoint it calls, and how it behaves in background tabs. Report file paths and line numbers. Do not modify files.",
  zh: "找出 Brabbler 侧边栏轮询运行中会话的位置：轮询间隔、调用的接口，以及在后台标签页中的行为。给出文件路径和行号，不要修改文件。",
};

export const extendSession: SessionScript = {
  id: SESSION_IDS.extend,
  cwd: PROJECT_ROOT,
  startedMinutesAgo: STARTED,
  name: { en: "Skills, plugins and subagents", zh: "技能、插件与子代理" },
  steps: [
    { kind: "model", provider: "openai-codex", modelId: "gpt-5.5" },
    { kind: "thinking", level: "medium" },
    {
      kind: "user",
      gapMinutes: 0.1,
      text: {
        en: "What are skills and plugins, and how do I manage them in Brabbler?",
        zh: "技能（skills）和插件（plugins）是什么？在 Brabbler 里怎么管理它们？",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "Explain skills, pi packages (plugins), project trust and subagents briefly, pointing at the relevant panels.",
            zh: "简要解释技能、pi 包（插件）、项目信任和子代理，并指出对应的面板。",
          },
          seconds: 13,
          text: {
            en: `Both extend what the agent can do — they differ in how much they bring along.

**Skills** are folders with a \`SKILL.md\`: a name, a one-line description and instructions. Only the description goes into the system prompt; I read the full file when a task matches. This demo has two:

- \`frontend-design\` — the model may use it on its own.
- \`release-notes\` — **model invocation is off**, so it only runs when you type \`/skill:release-notes\`.

In the application, **Settings → Skills & extensions** controls availability through groups, packages and individual resources, with independent Global, Project and own Session choices. Availability Off excludes a skill from advertising and explicit invocation; authored manual-only metadata is separate. Saving does not change a live conversation: explicit **Apply saved changes** acts now or reports busy, without waiting or automatic retries. This static demo only explains that flow; its old management controls are not available.

**Pi packages** can bundle **extensions** (tools, commands and ordinary session contributions), **skills**, **prompt templates** and **themes**. Pi or Nix owns installation, updates, removal and registration outside Brabbler. Prompt templates and themes keep native handling. **Settings → Built-in features** is separate: it holds bundled Git Workflow, Session Launch and Acceptance permissions in the application, not external package management.

**Project trust.** Skills, extensions and packages that come *with a repository* only load after you trust that project — Brabbler shows a warning in the top bar until you do.

**Subagents** are the third building block: I can hand a focused task to a separate agent. Want to see one in action?`,
            zh: `两者都能扩展 agent 的能力，区别在于携带的内容多少。

**技能** 是包含 \`SKILL.md\` 的文件夹：名称、一句话描述和具体说明。系统提示词里只放描述，任务匹配时我才会读取完整文件。这个演示里有两个技能：

- \`frontend-design\`——模型可以自行决定使用。
- \`release-notes\`——**关闭了模型调用**，只有你输入 \`/skill:release-notes\` 时才会运行。

应用中的 **Settings → Skills & extensions** 按组、包和独立资源控制可用性，各自支持 Global、Project 和当前 Session 选择。关闭可用性会同时排除技能的自动展示和显式调用；技能作者的仅手动调用元数据与此独立。保存不会改变正在使用的会话；明确点击 **Apply saved changes** 后立即应用或报告忙碌，不等待也不自动重试。此静态演示只说明流程，不提供旧的管理控件。

**Pi 包** 可以包含扩展、技能、提示词模板和主题。安装、更新、移除及注册由 Brabbler 之外的 Pi 或 Nix 管理。提示词模板和主题保留原生行为。应用中的 **Settings → Built-in features** 单独提供内置 Git Workflow、Session Launch 和 Acceptance 权限，不是外部包管理。

**项目信任**：*仓库自带* 的技能、扩展和包，只有在你信任该项目后才会加载——在此之前，Brabbler 会在顶部栏显示提醒。

**子代理** 是第三种能力：我可以把一个聚焦的任务交给另一个独立的 agent。要不要现场演示一下？`,
          },
        },
      ],
    },
    {
      kind: "user",
      gapMinutes: 1.5,
      text: {
        en: "Yes — use a subagent to find where the sidebar polls for running sessions.",
        zh: "好——用子代理找一下侧边栏在哪里轮询运行中的会话。",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "A read-only search task: delegate to the built-in explore profile in the foreground, since I need the answer right away.",
            zh: "这是只读的搜索任务：交给内置的 explore 子代理，前台运行，因为马上就需要结果。",
          },
          seconds: 5,
          tools: [{
            name: "Agent",
            args: { subagent_type: "explore", description: "Find running-session polling", prompt: TASK.en },
            result: {
              en: `Subagent ${SESSION_IDS.extendSubagent} completed.\n\n${REPORT.en}`,
              zh: `Subagent ${SESSION_IDS.extendSubagent} completed.\n\n${REPORT.zh}`,
            },
            details: {
              kind: "brabbler-subagent",
              sessionId: SESSION_IDS.extendSubagent,
              profile: "explore",
              description: "Find running-session polling",
              status: "completed",
              runInBackground: false,
              createdAt: "2026-09-20T10:00:00.000Z",
              completedAt: "2026-09-20T10:00:41.000Z",
            },
            seconds: 41,
          }],
        },
        {
          seconds: 10,
          text: {
            en: `The explore subagent found it: the sidebar polls \`GET /api/agent/running\` every **2.5 s** from \`components/SessionSidebar.tsx\` (line 169 for the interval, ~line 605 for the fetch), pauses while the tab is hidden, and reloads the session list when \`sessionListVersion\` changes.

A few things to notice about how that ran:

- **It's a real session.** Click the arrow on the **Agent** card above, the **Agents** button in the top bar, or the child row under this session in the sidebar to read its full transcript and tool calls.
- **Profiles.** \`explore\` and \`plan\` are read-only; \`general-purpose\` can edit files. **Settings → Sub-agents** turns subagents on or off and lets you write your own profiles with their own prompt, tools and model.
- **Foreground or background.** This one ran in the foreground because I needed the answer. Background runs let me keep working and report back when they're done.`,
            zh: `explore 子代理找到了：侧边栏在 \`components/SessionSidebar.tsx\` 中每 **2.5 秒** 轮询一次 \`GET /api/agent/running\`（间隔定义在第 169 行，请求大约在第 605 行），标签页隐藏时暂停，并在 \`sessionListVersion\` 变化时重新加载会话列表。

关于这次运行，有几点值得注意：

- **它是一个真实的会话**：点击上面 **Agent** 卡片上的箭头、顶部栏的 **Agents** 按钮，或侧边栏里本会话下方的子项，都能查看它完整的对话和工具调用。
- **配置**：\`explore\` 和 \`plan\` 是只读的；\`general-purpose\` 可以修改文件。**设置 → 子代理** 可以开关子代理功能，也可以编写你自己的配置，指定提示词、工具和模型。
- **前台或后台**：这次在前台运行，因为我需要马上拿到结果。后台运行时我可以继续干别的，子代理完成后会回来汇报。`,
          },
        },
      ],
    },
  ],
};

export const extendSubagentSession: SessionScript = {
  id: SESSION_IDS.extendSubagent,
  cwd: PROJECT_ROOT,
  startedMinutesAgo: STARTED - 3,
  relation: {
    kind: "subagent",
    parentSessionId: SESSION_IDS.extend,
    profile: "explore",
    description: "Find running-session polling",
    status: "completed",
  },
  steps: [
    { kind: "model", provider: "openai-codex", modelId: "gpt-5.6-luna" },
    { kind: "thinking", level: "low" },
    { kind: "tools", tools: ["read", "grep", "find", "ls"] },
    { kind: "user", gapMinutes: 0.05, text: TASK },
    {
      kind: "assistant",
      rounds: [
        {
          seconds: 3,
          tools: [{ name: "grep", args: { pattern: "RUNNING_SESSIONS_POLL_MS|/api/agent/running", path: "." }, result: GREP_OUTPUT }],
        },
        {
          seconds: 4,
          tools: [{ name: "read", args: { path: "components/SessionSidebar.tsx" }, result: { readFile: "components/SessionSidebar.tsx", anchor: "const poll = async () =>", anchorLinesBefore: 10, limit: 58 } }],
        },
        { seconds: 18, text: REPORT },
      ],
    },
  ],
};
