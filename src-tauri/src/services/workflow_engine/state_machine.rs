use serde::{Deserialize, Serialize};

/// Workflow execution lifecycle states.
///
/// ```text
/// IDLE -> SCHEDULED -> RUNNING <-> PAUSED -> COMPLETED
///                        |                     FAILED
///                        |                     CANCELLED
///                        +---> FAILED
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkflowState {
    Idle,
    Scheduled,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[allow(dead_code)]
impl WorkflowState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "IDLE",
            Self::Scheduled => "SCHEDULED",
            Self::Running => "RUNNING",
            Self::Paused => "PAUSED",
            Self::Completed => "COMPLETED",
            Self::Failed => "FAILED",
            Self::Cancelled => "CANCELLED",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "IDLE" => Some(Self::Idle),
            "SCHEDULED" => Some(Self::Scheduled),
            "RUNNING" => Some(Self::Running),
            "PAUSED" => Some(Self::Paused),
            "COMPLETED" => Some(Self::Completed),
            "FAILED" => Some(Self::Failed),
            "CANCELLED" => Some(Self::Cancelled),
            _ => None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    /// Returns true if transitioning from `self` to `target` is valid.
    pub fn can_transition_to(&self, target: &WorkflowState) -> bool {
        matches!(
            (self, target),
            (Self::Idle, Self::Scheduled)
                | (Self::Idle, Self::Running)
                | (Self::Scheduled, Self::Running)
                | (Self::Scheduled, Self::Cancelled)
                | (Self::Running, Self::Paused)
                | (Self::Running, Self::Completed)
                | (Self::Running, Self::Failed)
                | (Self::Running, Self::Cancelled)
                | (Self::Paused, Self::Running)
                | (Self::Paused, Self::Cancelled)
        )
    }

    /// Attempt a state transition, returning the new state or an error message.
    pub fn transition(self, target: WorkflowState) -> Result<WorkflowState, String> {
        if self.can_transition_to(&target) {
            Ok(target)
        } else {
            Err(format!(
                "Invalid state transition: {} -> {}",
                self.as_str(),
                target.as_str()
            ))
        }
    }
}

/// Per-node execution status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NodeState {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl NodeState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Running => "RUNNING",
            Self::Completed => "COMPLETED",
            Self::Failed => "FAILED",
            Self::Skipped => "SKIPPED",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_transitions() {
        assert!(WorkflowState::Idle.can_transition_to(&WorkflowState::Running));
        assert!(WorkflowState::Running.can_transition_to(&WorkflowState::Completed));
        assert!(WorkflowState::Running.can_transition_to(&WorkflowState::Failed));
        assert!(WorkflowState::Running.can_transition_to(&WorkflowState::Paused));
        assert!(WorkflowState::Paused.can_transition_to(&WorkflowState::Running));
    }

    #[test]
    fn invalid_transitions() {
        assert!(!WorkflowState::Completed.can_transition_to(&WorkflowState::Running));
        assert!(!WorkflowState::Failed.can_transition_to(&WorkflowState::Running));
        assert!(!WorkflowState::Idle.can_transition_to(&WorkflowState::Completed));
    }
}
