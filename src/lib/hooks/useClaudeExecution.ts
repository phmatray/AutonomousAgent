import { useState, useCallback, useRef, useEffect } from 'react';
import {
  executePlan,
  onClaudeStdout,
  onClaudeStderr,
  onClaudeComplete,
  type ClaudeOutput,
  type ClaudeExecutionComplete,
} from '@/lib/api/claude';

interface UseClaudeExecutionOptions {
  onOutput?: (data: ClaudeOutput) => void;
  onComplete?: (data: ClaudeExecutionComplete) => void;
  onError?: (error: string) => void;
}

interface UseClaudeExecutionReturn {
  execute: (prompt: string, workingDir?: string) => Promise<string>;
  isRunning: boolean;
  output: string;
  error: string | null;
  executionId: string | null;
  reset: () => void;
}

export function useClaudeExecution(
  options: UseClaudeExecutionOptions = {},
): UseClaudeExecutionReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const unlistenRefs = useRef<Array<() => void>>([]);

  useEffect(() => {
    return () => {
      unlistenRefs.current.forEach((fn) => fn());
      unlistenRefs.current = [];
    };
  }, []);

  const reset = useCallback(() => {
    setOutput('');
    setError(null);
    setIsRunning(false);
    setExecutionId(null);
  }, []);

  const execute = useCallback(
    async (prompt: string, workingDir?: string): Promise<string> => {
      setIsRunning(true);
      setOutput('');
      setError(null);

      // Set up event listeners before starting execution
      const stdoutUnlisten = await onClaudeStdout((data) => {
        setOutput((prev) => prev + data.content + '\n');
        options.onOutput?.(data);
      });
      const stderrUnlisten = await onClaudeStderr((data) => {
        setOutput((prev) => prev + data.content + '\n');
        options.onOutput?.(data);
      });
      const completeUnlisten = await onClaudeComplete((data) => {
        setIsRunning(false);
        if (!data.success) {
          setError(`Execution failed with exit code ${data.exit_code}`);
          options.onError?.(`Exit code: ${data.exit_code}`);
        }
        options.onComplete?.(data);

        // Clean up listeners
        unlistenRefs.current.forEach((fn) => fn());
        unlistenRefs.current = [];
      });

      unlistenRefs.current = [stdoutUnlisten, stderrUnlisten, completeUnlisten];

      try {
        const result = await executePlan({
          prompt,
          workingDir,
        });
        setExecutionId(result.id);
        return result.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setIsRunning(false);
        options.onError?.(message);
        // Clean up listeners on error
        unlistenRefs.current.forEach((fn) => fn());
        unlistenRefs.current = [];
        return '';
      }
    },
    [options],
  );

  return { execute, isRunning, output, error, executionId, reset };
}
