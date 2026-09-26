// Git's environment can override -C, repository discovery, the index, and
// configuration. Keep each subprocess independent of inherited Git state.
export function gitExecEnv(indexFile?: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...inherited };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  env.LC_ALL = "C";
  env.GIT_TERMINAL_PROMPT = "0";
  // Only the commit candidate's private temporary index may opt in to this override.
  if (indexFile !== undefined) env.GIT_INDEX_FILE = indexFile;
  return env;
}
