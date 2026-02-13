use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Describes when a workflow should be triggered.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TriggerConfig {
    /// Triggered manually via the UI or API.
    Manual,
    /// Triggered on a cron schedule (e.g. "0 */6 * * *").
    Cron { expression: String },
    /// Triggered by an external webhook.
    Webhook { path: String },
    /// Triggered when the workflow returns to IDLE state.
    StateIdle,
}

/// A scheduled workflow entry.
#[derive(Debug, Clone)]
struct ScheduledWorkflow {
    workflow_id: String,
    trigger: TriggerConfig,
    enabled: bool,
}

/// Manages workflow triggers and scheduling.
///
/// For MVP, this supports manual triggers and state-based triggers.
/// Cron and webhook triggers store their configuration but execution
/// is deferred to a future phase.
pub struct Scheduler {
    schedules: Arc<RwLock<HashMap<String, ScheduledWorkflow>>>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            schedules: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a workflow with a trigger configuration.
    pub async fn register(
        &self,
        workflow_id: &str,
        trigger: TriggerConfig,
    ) {
        let mut schedules = self.schedules.write().await;
        schedules.insert(
            workflow_id.to_string(),
            ScheduledWorkflow {
                workflow_id: workflow_id.to_string(),
                trigger,
                enabled: true,
            },
        );
    }

    /// Unregister a workflow from scheduling.
    pub async fn unregister(&self, workflow_id: &str) {
        self.schedules.write().await.remove(workflow_id);
    }

    /// Enable or disable a schedule.
    pub async fn set_enabled(&self, workflow_id: &str, enabled: bool) -> bool {
        let mut schedules = self.schedules.write().await;
        if let Some(entry) = schedules.get_mut(workflow_id) {
            entry.enabled = enabled;
            true
        } else {
            false
        }
    }

    /// Check if a workflow should run based on a manual trigger.
    pub async fn should_trigger_manual(&self, workflow_id: &str) -> bool {
        let schedules = self.schedules.read().await;
        schedules
            .get(workflow_id)
            .map(|s| s.enabled && matches!(s.trigger, TriggerConfig::Manual))
            .unwrap_or(true) // Unregistered workflows can always be triggered manually
    }

    /// Get all workflows that should trigger on state becoming idle.
    pub async fn get_idle_triggered_workflows(&self) -> Vec<String> {
        let schedules = self.schedules.read().await;
        schedules
            .values()
            .filter(|s| s.enabled && matches!(s.trigger, TriggerConfig::StateIdle))
            .map(|s| s.workflow_id.clone())
            .collect()
    }

    /// Get the trigger configuration for a workflow.
    pub async fn get_trigger(&self, workflow_id: &str) -> Option<TriggerConfig> {
        let schedules = self.schedules.read().await;
        schedules.get(workflow_id).map(|s| s.trigger.clone())
    }

    /// List all registered schedules.
    pub async fn list_schedules(&self) -> Vec<(String, TriggerConfig, bool)> {
        let schedules = self.schedules.read().await;
        schedules
            .values()
            .map(|s| (s.workflow_id.clone(), s.trigger.clone(), s.enabled))
            .collect()
    }
}
