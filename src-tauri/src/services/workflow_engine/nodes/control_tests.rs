#[cfg(test)]
mod tests {
    use crate::services::workflow_engine::node_registry::{
        ClaudeProvider, ExecutionContext, NodeExecutor, ServiceProvider,
    };
    use crate::services::workflow_engine::nodes::control::{
        ConditionNode, DelayNode, LoopNode, TriggerNode,
    };
    use crate::services::{GitHubClient, GitService};
    use serde_json::{json, Value};
    use std::sync::Arc;

    /// Helper to build a ServiceProvider for tests.
    fn test_services() -> ServiceProvider {
        ServiceProvider {
            github: Arc::new(GitHubClient::new()),
            claude: Arc::new(ClaudeProvider::new())
                as Arc<dyn crate::services::workflow_engine::node_registry::ClaudeRunner>,
            git: Arc::new(GitService::new()),
        }
    }

    /// Helper to build an empty ExecutionContext.
    fn empty_context() -> ExecutionContext {
        ExecutionContext::new(Value::Object(Default::default()))
    }

    // ---------------------------------------------------------------
    // TriggerNode tests
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn trigger_node_type_is_trigger() {
        let node = TriggerNode;
        assert_eq!(node.node_type(), "trigger");
    }

    #[tokio::test]
    async fn trigger_node_default_manual_type() {
        let node = TriggerNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({});

        let result = node
            .execute("trigger1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["trigger_type"], "manual");
        assert!(result["triggered_at"].is_string());
    }

    #[tokio::test]
    async fn trigger_node_custom_trigger_type() {
        let node = TriggerNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({"trigger_type": "cron"});

        let result = node
            .execute("trigger1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["trigger_type"], "cron");
        assert!(result["triggered_at"].is_string());
    }

    #[tokio::test]
    async fn trigger_node_webhook_type() {
        let node = TriggerNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({"trigger_type": "webhook"});

        let result = node
            .execute("trigger1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["trigger_type"], "webhook");
    }

    #[tokio::test]
    async fn trigger_node_returns_rfc3339_timestamp() {
        let node = TriggerNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({});

        let result = node
            .execute("trigger1", &config, &ctx, &services)
            .await
            .unwrap();

        let ts = result["triggered_at"].as_str().unwrap();
        // RFC3339 timestamps contain 'T' and '+' or 'Z'
        assert!(ts.contains('T'), "Expected RFC3339 timestamp, got: {}", ts);
    }

    // ---------------------------------------------------------------
    // ConditionNode tests
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn condition_node_type_is_condition() {
        let node = ConditionNode;
        assert_eq!(node.node_type(), "condition");
    }

    #[tokio::test]
    async fn condition_validate_missing_condition() {
        let node = ConditionNode;
        let config = json!({"operator": "eq"});
        assert!(node.validate(&config).is_err());
    }

    #[tokio::test]
    async fn condition_validate_with_condition() {
        let node = ConditionNode;
        let config = json!({"condition": "something"});
        assert!(node.validate(&config).is_ok());
    }

    #[tokio::test]
    async fn condition_eq_true() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({
            "condition": "hello",
            "operator": "eq",
            "value": "hello"
        });

        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["result"], true);
        assert_eq!(result["branch"], "true");
    }

    #[tokio::test]
    async fn condition_eq_false() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({
            "condition": "hello",
            "operator": "eq",
            "value": "world"
        });

        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["result"], false);
        assert_eq!(result["branch"], "false");
    }

    #[tokio::test]
    async fn condition_neq_operator() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({
            "condition": "hello",
            "operator": "neq",
            "value": "world"
        });

        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["result"], true);
        assert_eq!(result["branch"], "true");
    }

    #[tokio::test]
    async fn condition_gt_operator() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({
            "condition": 10,
            "operator": "gt",
            "value": 5
        });

        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);
    }

    #[tokio::test]
    async fn condition_lt_operator() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({
            "condition": 3,
            "operator": "lt",
            "value": 7
        });

        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);
    }

    #[tokio::test]
    async fn condition_gte_operator() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        // Equal case
        let config = json!({
            "condition": 5,
            "operator": "gte",
            "value": 5
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);

        // Greater case
        let config = json!({
            "condition": 6,
            "operator": "gte",
            "value": 5
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);

        // Less case
        let config = json!({
            "condition": 4,
            "operator": "gte",
            "value": 5
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);
    }

    #[tokio::test]
    async fn condition_lte_operator() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        let config = json!({
            "condition": 5,
            "operator": "lte",
            "value": 5
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);

        let config = json!({
            "condition": 6,
            "operator": "lte",
            "value": 5
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);
    }

    #[tokio::test]
    async fn condition_exists_operator() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        // Exists: non-null value
        let config = json!({
            "condition": "anything",
            "operator": "exists"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);
    }

    #[tokio::test]
    async fn condition_exists_null_is_false() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        // Null coercion bug fix test: null should evaluate to false for "exists"
        let config = json!({
            "condition": null,
            "operator": "exists"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);
        assert_eq!(result["branch"], "false");
    }

    #[tokio::test]
    async fn condition_not_empty_string() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        // Non-empty string
        let config = json!({
            "condition": "hello",
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);

        // Empty string
        let config = json!({
            "condition": "",
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);
    }

    #[tokio::test]
    async fn condition_not_empty_array() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        let config = json!({
            "condition": [1, 2, 3],
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);

        let config = json!({
            "condition": [],
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);
    }

    #[tokio::test]
    async fn condition_not_empty_object() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        let config = json!({
            "condition": {"key": "val"},
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);

        let config = json!({
            "condition": {},
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);
    }

    #[tokio::test]
    async fn condition_not_empty_null_is_false() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        // Null coercion bug fix: null should be "not not_empty" -> false
        let config = json!({
            "condition": null,
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);
    }

    #[tokio::test]
    async fn condition_not_empty_number_zero_is_false() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        let config = json!({
            "condition": 0,
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);

        let config = json!({
            "condition": 42,
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);
    }

    #[tokio::test]
    async fn condition_not_empty_bool() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        let config = json!({
            "condition": true,
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);

        let config = json!({
            "condition": false,
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);
    }

    #[tokio::test]
    async fn condition_default_operator_is_not_empty() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        // No operator specified, should default to "not_empty"
        let config = json!({
            "condition": "hello"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);
    }

    #[tokio::test]
    async fn condition_unknown_operator_returns_false() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        let config = json!({
            "condition": "hello",
            "operator": "unknown_op",
            "value": "hello"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], false);
    }

    #[tokio::test]
    async fn condition_with_template_reference_eq() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        // Set up a previous node output
        ctx.set_node_output("issues".into(), json!({"status": "open"}));

        // Template resolves "{{issues.status}}" to the string "open"
        let config = json!({
            "condition": "{{issues.status}}",
            "operator": "eq",
            "value": "open"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);
        assert_eq!(result["branch"], "true");
    }

    #[tokio::test]
    async fn condition_with_template_reference_not_empty() {
        let node = ConditionNode;
        let services = test_services();
        let ctx = empty_context();

        ctx.set_node_output("issues".into(), json!({"count": 5}));

        // Template resolves "{{issues.count}}" to the string "5",
        // and "not_empty" on a non-empty string returns true.
        let config = json!({
            "condition": "{{issues.count}}",
            "operator": "not_empty"
        });
        let result = node
            .execute("cond1", &config, &ctx, &services)
            .await
            .unwrap();
        assert_eq!(result["result"], true);
    }

    // ---------------------------------------------------------------
    // LoopNode tests
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn loop_node_type_is_loop() {
        let node = LoopNode;
        assert_eq!(node.node_type(), "loop");
    }

    #[tokio::test]
    async fn loop_validate_missing_items() {
        let node = LoopNode;
        let config = json!({"max_iterations": 5});
        assert!(node.validate(&config).is_err());
    }

    #[tokio::test]
    async fn loop_validate_with_items() {
        let node = LoopNode;
        let config = json!({"items": [1, 2, 3]});
        assert!(node.validate(&config).is_ok());
    }

    #[tokio::test]
    async fn loop_empty_array() {
        let node = LoopNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({"items": []});

        let result = node
            .execute("loop1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["total"], 0);
        assert!(result["current_item"].is_null());
        assert_eq!(result["index"], 0);
        assert_eq!(result["items"], json!([]));
    }

    #[tokio::test]
    async fn loop_single_item() {
        let node = LoopNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({"items": ["only_one"]});

        let result = node
            .execute("loop1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["total"], 1);
        assert_eq!(result["current_item"], "only_one");
        assert_eq!(result["index"], 0);
        assert_eq!(result["items"], json!(["only_one"]));
    }

    #[tokio::test]
    async fn loop_multiple_items() {
        let node = LoopNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({"items": ["a", "b", "c"]});

        let result = node
            .execute("loop1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["total"], 3);
        assert_eq!(result["current_item"], "a");
        assert_eq!(result["index"], 0);
        assert_eq!(result["items"], json!(["a", "b", "c"]));
    }

    #[tokio::test]
    async fn loop_max_iterations_caps_items() {
        let node = LoopNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({
            "items": [1, 2, 3, 4, 5],
            "max_iterations": 3
        });

        let result = node
            .execute("loop1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["total"], 3);
        assert_eq!(result["items"], json!([1, 2, 3]));
        assert_eq!(result["current_item"], 1);
    }

    #[tokio::test]
    async fn loop_max_iterations_larger_than_array() {
        let node = LoopNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({
            "items": [1, 2],
            "max_iterations": 100
        });

        let result = node
            .execute("loop1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["total"], 2);
        assert_eq!(result["items"], json!([1, 2]));
    }

    #[tokio::test]
    async fn loop_with_object_items() {
        let node = LoopNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({
            "items": [
                {"title": "issue 1", "number": 1},
                {"title": "issue 2", "number": 2}
            ]
        });

        let result = node
            .execute("loop1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["total"], 2);
        assert_eq!(result["current_item"]["title"], "issue 1");
        assert_eq!(result["current_item"]["number"], 1);
    }

    #[tokio::test]
    async fn loop_non_array_items_fails() {
        let node = LoopNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({"items": "not an array"});

        let result = node.execute("loop1", &config, &ctx, &services).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn loop_with_nested_array_items() {
        let node = LoopNode;
        let services = test_services();
        let ctx = empty_context();

        // Test with nested arrays as items
        let config = json!({
            "items": [[1, 2], [3, 4], [5, 6]]
        });
        let result = node
            .execute("loop1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["total"], 3);
        assert_eq!(result["current_item"], json!([1, 2]));
        assert_eq!(result["index"], 0);
    }

    #[tokio::test]
    async fn loop_max_iterations_zero_returns_empty() {
        let node = LoopNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({
            "items": [1, 2, 3],
            "max_iterations": 0
        });

        let result = node
            .execute("loop1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["total"], 0);
        assert!(result["current_item"].is_null());
        assert_eq!(result["items"], json!([]));
    }

    // ---------------------------------------------------------------
    // DelayNode tests
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn delay_node_type_is_delay() {
        let node = DelayNode;
        assert_eq!(node.node_type(), "delay");
    }

    #[tokio::test]
    async fn delay_validate_missing_seconds() {
        let node = DelayNode;
        let config = json!({});
        assert!(node.validate(&config).is_err());
    }

    #[tokio::test]
    async fn delay_validate_non_integer_seconds() {
        let node = DelayNode;
        let config = json!({"seconds": "not a number"});
        assert!(node.validate(&config).is_err());
    }

    #[tokio::test]
    async fn delay_validate_valid_seconds() {
        let node = DelayNode;
        let config = json!({"seconds": 5});
        assert!(node.validate(&config).is_ok());
    }

    #[tokio::test]
    async fn delay_executes_and_returns_waited_seconds() {
        let node = DelayNode;
        let services = test_services();
        let ctx = empty_context();
        // Use 0 seconds for fast test execution
        let config = json!({"seconds": 0});

        let result = node
            .execute("delay1", &config, &ctx, &services)
            .await
            .unwrap();

        assert_eq!(result["waited_seconds"], 0);
    }

    #[tokio::test]
    async fn delay_one_second() {
        let node = DelayNode;
        let services = test_services();
        let ctx = empty_context();
        let config = json!({"seconds": 1});

        let start = std::time::Instant::now();
        let result = node
            .execute("delay1", &config, &ctx, &services)
            .await
            .unwrap();
        let elapsed = start.elapsed();

        assert_eq!(result["waited_seconds"], 1);
        assert!(
            elapsed >= std::time::Duration::from_millis(900),
            "Expected at least 900ms delay, got {:?}",
            elapsed
        );
    }

    #[tokio::test]
    async fn delay_default_to_one_second_on_missing() {
        let node = DelayNode;
        let services = test_services();
        let ctx = empty_context();
        // Config without seconds but bypassing validation
        let config = json!({});

        let start = std::time::Instant::now();
        let result = node
            .execute("delay1", &config, &ctx, &services)
            .await
            .unwrap();
        let elapsed = start.elapsed();

        // Default unwrap_or(1) means 1 second
        assert_eq!(result["waited_seconds"], 1);
        assert!(elapsed >= std::time::Duration::from_millis(900));
    }
}
