import { describe, it, expect, vi, beforeEach } from "vitest";
import { restartContainerViaSsh, SshConfig } from "./SshRestart";

// Mock child_process.exec - define mock inside factory to avoid hoisting issues
vi.mock("child_process", () => {
  const mockExec = vi.fn();
  return {
    exec: mockExec,
  };
});

// Mock util.promisify - we need to capture the mock exec function
let capturedMockExec: ReturnType<typeof vi.fn> | null = null;

vi.mock("util", () => {
  return {
    promisify: vi.fn((fn) => {
      // This will be called with exec, and we return a function that uses the mocked exec
      return (command: string, options?: { env?: Record<string, string> }) => {
        return new Promise((resolve, reject) => {
          // Use the captured mock exec
          if (capturedMockExec) {
            capturedMockExec(command, options, (error: Error | null, stdout: string, stderr: string) => {
              if (error) {
                reject(error);
              } else {
                resolve({ stdout, stderr });
              }
            });
          } else {
            reject(new Error("Mock exec not initialized"));
          }
        });
      };
    }),
  };
});

describe("SshRestart", () => {
  let mockExec: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Get the mocked exec function using vi.mocked
    const { exec } = await import("child_process");
    mockExec = vi.mocked(exec);
    
    // Capture the mock for use in promisify mock
    capturedMockExec = mockExec;
    
    // Setup default mock behavior for exec
    mockExec.mockImplementation(
      (
        command: string,
        options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        if (callback) {
          // Call immediately to simulate successful SSH command
          callback(null, "Container restarted\n", "");
        }
        return {} as ReturnType<typeof import("child_process").exec>;
      }
    );
  });

  it("should call execAsync with SSHPASS environment variable when password is provided", async () => {
    const sshConfig: SshConfig = {
      user: "admin",
      host: "172.16.0.42",
      port: "22",
      password: "secret123!@#",
    };

    await restartContainerViaSsh({
      sshConfig,
      containerName: "test-container",
    });

    // Verify exec was called
    expect(mockExec).toHaveBeenCalled();

    const sshCall = mockExec.mock.calls[0];
    expect(sshCall).toBeDefined();

    const command = sshCall[0] as string;
    const options = sshCall[1] as { env?: Record<string, string> };

    // Verify the command contains sshpass
    expect(command).toContain("sshpass -e");
    expect(command).toContain("admin@172.16.0.42");
    expect(command).toContain("docker restart test-container");

    // Verify SSHPASS is in the environment
    expect(options?.env?.SSHPASS).toBe("secret123!@#");
  });

  it("should use sshpass when password is provided", async () => {
    const sshConfig: SshConfig = {
      user: "deploy",
      host: "203.0.113.45",
      port: "22",
      password: "securePass456",
    };

    await restartContainerViaSsh({
      sshConfig,
      containerName: "my-container",
    });

    const sshCall = mockExec.mock.calls[0];
    expect(sshCall).toBeDefined();

    const command = sshCall[0] as string;
    const options = sshCall[1] as { env?: Record<string, string> };

    expect(command).toContain("sshpass -e ssh");
    expect(command).toContain("deploy@203.0.113.45");
    expect(command).toContain("docker restart my-container");
    expect(options?.env?.SSHPASS).toBe("securePass456");
  });

  it("should use key-based authentication when password is not provided", async () => {
    const sshConfig: SshConfig = {
      user: "root",
      host: "198.51.100.10",
      port: "22",
      password: "",
    };

    await restartContainerViaSsh({
      sshConfig,
      containerName: "test-container",
    });

    const sshCall = mockExec.mock.calls[0];
    expect(sshCall).toBeDefined();

    const command = sshCall[0] as string;
    const options = sshCall[1] as { env?: Record<string, string> };

    // Should not use sshpass
    expect(command).not.toContain("sshpass");
    expect(command).toContain("ssh -o StrictHostKeyChecking=no");
    expect(command).toContain("root@198.51.100.10");
    expect(command).toContain("docker restart test-container");

    // Should not have SSHPASS in env (or env might be undefined)
    if (options?.env) {
      expect(options.env.SSHPASS).toBeUndefined();
    }
  });

  it("should include custom port in SSH command when port is not 22", async () => {
    const sshConfig: SshConfig = {
      user: "appuser",
      host: "172.20.5.15",
      port: "2200",
      password: "",
    };

    await restartContainerViaSsh({
      sshConfig,
      containerName: "test-container",
    });

    const sshCall = mockExec.mock.calls[0];
    expect(sshCall).toBeDefined();

    const command = sshCall[0] as string;

    // Should include port in host string
    expect(command).toContain("appuser@172.20.5.15:2200");
  });

  it("should default to port 22 when port is empty", async () => {
    const sshConfig: SshConfig = {
      user: "operator",
      host: "10.50.75.200",
      port: "",
      password: "",
    };

    await restartContainerViaSsh({
      sshConfig,
      containerName: "test-container",
    });

    const sshCall = mockExec.mock.calls[0];
    expect(sshCall).toBeDefined();

    const command = sshCall[0] as string;

    // Should not include port (defaults to 22)
    expect(command).toContain("operator@10.50.75.200");
    expect(command).not.toContain("10.50.75.200:22");
  });

  it("should throw error when host or user is not configured", async () => {
    const sshConfig: SshConfig = {
      user: "",
      host: "",
      port: "22",
      password: "",
    };

    await expect(
      restartContainerViaSsh({
        sshConfig,
        containerName: "test-container",
      })
    ).rejects.toThrow("BLE_SSH_HOST and BLE_SSH_USER must be configured");
  });

  it("should throw error when only host is missing", async () => {
    const sshConfig: SshConfig = {
      user: "testuser",
      host: "",
      port: "22",
      password: "",
    };

    await expect(
      restartContainerViaSsh({
        sshConfig,
        containerName: "test-container",
      })
    ).rejects.toThrow("BLE_SSH_HOST and BLE_SSH_USER must be configured");
  });

  it("should throw error when only user is missing", async () => {
    const sshConfig: SshConfig = {
      user: "",
      host: "192.168.1.1",
      port: "22",
      password: "",
    };

    await expect(
      restartContainerViaSsh({
        sshConfig,
        containerName: "test-container",
      })
    ).rejects.toThrow("BLE_SSH_HOST and BLE_SSH_USER must be configured");
  });
});

