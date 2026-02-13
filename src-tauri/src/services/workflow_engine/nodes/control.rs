use crate::errors::{AppError, Result};
use crate::services::workflow_engine::node_registry::{
    ExecutionContext, NodeExecutor, ServiceProvider,
};
use async_trait::async_trait;
use serde_json::Value;

/// Trigger node -- the entry point of a workflow.
///
/// Config:
///   - `trigger_type`: "manual", "cron", "webhook", "state" (informational)
///   - Any additional trigger metadata
///
/// Output:
///   - `triggered_at`: ISO timestamp
///   - `trigger_type`: the trigger type
pub struct TriggerNode;

#[async_trait]
impl NodeExecutor for TriggerNode {
    fn node_type(&self) -> &'static str {
        "trigger"
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        _context: &ExecutionContext,
        _services: &ServiceProvider,
    ) -> Result<Value> {
        let trigger_type = config["trigger_type"].as_str().unwrap_or("manual");

        Ok(serde_json::json!({
            "triggered_at": chrono::Utc::now().to_rfc3339(),
            "trigger_type": trigger_type,
        }))
    }
}

/// Cron trigger node -- entry point for cron-based workflows.
///
/// Config:
///   - `schedule`: cron expression (required)
///   - `timezone`: IANA timezone identifier (optional, defaults to UTC)
///
/// Output:
///   - `triggered_at`: ISO timestamp
///   - `trigger_type`: always "cron"
///   - `schedule`: configured schedule
///   - `timezone`: configured timezone
pub struct CronTriggerNode;

#[async_trait]
impl NodeExecutor for CronTriggerNode {
    fn node_type(&self) -> &'static str {
        "trigger.cron"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        if config
            .get("schedule")
            .and_then(|v| v.as_str())
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
        {
            Ok(())
        } else {
            Err(AppError::Validation(
                "trigger.cron requires 'schedule' in config".into(),
            ))
        }
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        _context: &ExecutionContext,
        _services: &ServiceProvider,
    ) -> Result<Value> {
        let schedule = config["schedule"].as_str().unwrap_or("0 * * * *").trim();
        let timezone = config["timezone"].as_str().unwrap_or("UTC").trim();

        Ok(serde_json::json!({
            "triggered_at": chrono::Utc::now().to_rfc3339(),
            "trigger_type": "cron",
            "schedule": schedule,
            "timezone": timezone,
        }))
    }
}

/// Condition node -- branch execution based on a simple expression.
///
/// Config:
///   - `condition`: a reference like `{{node_id.field}}` or a literal value
///   - `operator`: "eq", "neq", "gt", "lt", "gte", "lte", "exists", "not_empty"
///   - `value`: the comparison value (not needed for "exists" / "not_empty")
///
/// Output:
///   - `result`: boolean -- whether the condition was met
///   - `branch`: "true" or "false"
pub struct ConditionNode;

#[async_trait]
impl NodeExecutor for ConditionNode {
    fn node_type(&self) -> &'static str {
        "condition"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        if config.get("condition").is_none() {
            return Err(AppError::Validation(
                "condition node requires 'condition' in config".into(),
            ));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
        _services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config)?;
        let condition_val = &resolved["condition"];
        let operator = resolved["operator"].as_str().unwrap_or("not_empty");
        let compare_val = &resolved["value"];

        let result = evaluate_condition(condition_val, operator, compare_val);

        Ok(serde_json::json!({
            "result": result,
            "branch": if result { "true" } else { "false" },
        }))
    }
}

fn evaluate_condition(condition: &Value, operator: &str, compare: &Value) -> bool {
    match operator {
        "exists" => !condition.is_null(),
        "not_empty" => match condition {
            Value::Null => false,
            Value::String(s) => !s.is_empty(),
            Value::Array(a) => !a.is_empty(),
            Value::Object(o) => !o.is_empty(),
            Value::Number(n) => n.as_f64().map(|v| v != 0.0).unwrap_or(false),
            Value::Bool(b) => *b,
        },
        "eq" => condition == compare,
        "neq" => condition != compare,
        "gt" => {
            let a = condition.as_f64().unwrap_or(0.0);
            let b = compare.as_f64().unwrap_or(0.0);
            a > b
        }
        "lt" => {
            let a = condition.as_f64().unwrap_or(0.0);
            let b = compare.as_f64().unwrap_or(0.0);
            a < b
        }
        "gte" => {
            let a = condition.as_f64().unwrap_or(0.0);
            let b = compare.as_f64().unwrap_or(0.0);
            a >= b
        }
        "lte" => {
            let a = condition.as_f64().unwrap_or(0.0);
            let b = compare.as_f64().unwrap_or(0.0);
            a <= b
        }
        _ => false,
    }
}

/// Loop node -- iterate over an array and execute downstream nodes for each item.
///
/// Config:
///   - `items`: a reference to an array (e.g. `{{readIssues.issues}}`) or a literal array
///   - `max_iterations`: optional cap on the number of iterations
///
/// Output:
///   - `current_item`: the current iteration item
///   - `index`: current iteration index
///   - `total`: total number of items
///   - `items`: the full list
pub struct LoopNode;

#[async_trait]
impl NodeExecutor for LoopNode {
    fn node_type(&self) -> &'static str {
        "loop"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        if config.get("items").is_none() {
            return Err(AppError::Validation(
                "loop node requires 'items' in config".into(),
            ));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
        _services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config)?;
        let items = resolved["items"]
            .as_array()
            .ok_or_else(|| AppError::Validation("loop 'items' must be an array".into()))?;
        let max_iterations = resolved["max_iterations"]
            .as_u64()
            .unwrap_or(items.len() as u64) as usize;

        let capped = items
            .iter()
            .take(max_iterations)
            .cloned()
            .collect::<Vec<_>>();
        let first = capped.first().cloned().unwrap_or(Value::Null);

        Ok(serde_json::json!({
            "current_item": first,
            "index": 0,
            "total": capped.len(),
            "items": capped,
        }))
    }
}

/// Delay node -- pause execution for a specified duration.
///
/// Config:
///   - `seconds`: number of seconds to wait
///
/// Output:
///   - `waited_seconds`: how long the delay lasted
pub struct DelayNode;

#[async_trait]
impl NodeExecutor for DelayNode {
    fn node_type(&self) -> &'static str {
        "delay"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        if config.get("seconds").and_then(|v| v.as_u64()).is_none() {
            return Err(AppError::Validation(
                "delay node requires 'seconds' (integer) in config".into(),
            ));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        _context: &ExecutionContext,
        _services: &ServiceProvider,
    ) -> Result<Value> {
        let seconds = config["seconds"].as_u64().unwrap_or(1);
        tokio::time::sleep(tokio::time::Duration::from_secs(seconds)).await;

        Ok(serde_json::json!({
            "waited_seconds": seconds,
        }))
    }
}
