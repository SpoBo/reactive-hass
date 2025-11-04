import { exec } from "child_process";
import { promisify } from "util";
import DEBUG from "debug";

const debug = DEBUG("r-h.ssh-restart");
const execAsync = promisify(exec);

export interface SshConfig {
  user: string;
  host: string;
  port: string;
  password: string;
}

export interface RestartOptions {
  sshConfig: SshConfig;
  containerName: string;
}

/**
 * Restart a Docker container via SSH
 * Supports both password-based and key-based authentication
 */
export async function restartContainerViaSsh(
  options: RestartOptions
): Promise<string> {
  const { sshConfig, containerName } = options;

  if (!sshConfig.host || !sshConfig.user) {
    throw new Error("BLE_SSH_HOST and BLE_SSH_USER must be configured");
  }

  // Build SSH connection string
  const port = sshConfig.port || "22";
  const hostString =
    port === "22" ? sshConfig.host : `${sshConfig.host}:${port}`;
  const sshTarget = `${sshConfig.user}@${hostString}`;

  let command: string;
  let env: NodeJS.ProcessEnv | undefined;

  if (sshConfig.password) {
    // Use sshpass -e to read from SSHPASS environment variable
    // This is more secure than -p as it doesn't expose the password in process list
    env = { ...process.env, SSHPASS: sshConfig.password };
    command = `sshpass -e ssh -o StrictHostKeyChecking=no ${sshTarget} "docker restart ${containerName}"`;
  } else {
    // Use key-based authentication
    command = `ssh -o StrictHostKeyChecking=no ${sshTarget} "docker restart ${containerName}"`;
  }

  debug(`Executing SSH command (password hidden in logs)`);

  const result = await execAsync(command, { env });

  if (result.stdout) {
    debug(`SSH stdout: ${result.stdout.trim()}`);
  }
  if (result.stderr) {
    debug(`SSH stderr: ${result.stderr.trim()}`);
  }

  debug("Container restarted successfully");
  return result.stdout.trim();
}

