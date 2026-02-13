use crate::errors::{AppError, Result};
use crate::services::workflow_engine::node_registry::{
    ExecutionContext, NodeExecutor, ServiceProvider,
};
use async_trait::async_trait;
use serde_json::Value;

/// Generate an implementation plan using Claude Code CLI.
///
/// Config:
///   - `prompt`: the planning prompt (can include template refs)
///   - `working_dir`: optional override for working directory
///   - `timeout_secs`: optional timeout in seconds
///
/// Output:
///   - `plan`: the generated plan text
pub struct ClaudePlanNode;

#[async_trait]
impl NodeExecutor for ClaudePlanNode {
    fn node_type(&self) -> &'static str {
        "claude.plan"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        if config.get("prompt").is_none() {
            return Err(AppError::Validation(
                "claude.plan requires 'prompt' in config".into(),
            ));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config)?;
        let prompt = resolved["prompt"]
            .as_str()
            .ok_or_else(|| AppError::Validation("prompt must be a string".into()))?;
        let working_dir = resolved["working_dir"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| context.get_working_dir());
        let timeout_secs = resolved["timeout_secs"].as_u64();

        let output = services
            .claude
            .run_prompt(prompt, working_dir.as_deref(), timeout_secs)
            .await?;

        Ok(serde_json::json!({
            "plan": output,
        }))
    }
}

/// Execute an implementation plan via Claude Code CLI.
///
/// Config:
///   - `prompt`: the execution prompt / instructions
///   - `working_dir`: optional override for working directory
///   - `timeout_secs`: optional timeout in seconds
///
/// Output:
///   - `output`: the CLI output
///   - `success`: boolean
pub struct ClaudeApplyNode;

#[async_trait]
impl NodeExecutor for ClaudeApplyNode {
    fn node_type(&self) -> &'static str {
        "claude.apply"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        if config.get("prompt").is_none() {
            return Err(AppError::Validation(
                "claude.apply requires 'prompt' in config".into(),
            ));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config)?;
        let prompt = resolved["prompt"]
            .as_str()
            .ok_or_else(|| AppError::Validation("prompt must be a string".into()))?;
        let working_dir = resolved["working_dir"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| context.get_working_dir());
        let timeout_secs = resolved["timeout_secs"].as_u64();

        let output = services
            .claude
            .run_prompt(prompt, working_dir.as_deref(), timeout_secs)
            .await?;

        Ok(serde_json::json!({
            "output": output,
            "success": true,
        }))
    }
}

/// Analyze issue context using Claude Code CLI.
///
/// Config:
///   - `prompt`: the analysis prompt
///   - `working_dir`: optional override
///   - `timeout_secs`: optional timeout
///
/// Output:
///   - `analysis`: the analysis text
pub struct ClaudeAnalyzeNode;

#[async_trait]
impl NodeExecutor for ClaudeAnalyzeNode {
    fn node_type(&self) -> &'static str {
        "claude.analyze"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        if config.get("prompt").is_none() {
            return Err(AppError::Validation(
                "claude.analyze requires 'prompt' in config".into(),
            ));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config)?;
        let prompt = resolved["prompt"]
            .as_str()
            .ok_or_else(|| AppError::Validation("prompt must be a string".into()))?;
        let working_dir = resolved["working_dir"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| context.get_working_dir());
        let timeout_secs = resolved["timeout_secs"].as_u64();

        let output = services
            .claude
            .run_prompt(prompt, working_dir.as_deref(), timeout_secs)
            .await?;

        Ok(serde_json::json!({
            "analysis": output,
        }))
    }
}
