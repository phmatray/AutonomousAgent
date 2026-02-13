#[cfg(test)]
mod tests {
    use crate::errors::AppError;
    use crate::services::workflow_engine::node_registry::{ExecutionContext, NodeExecutor};
    use crate::services::workflow_engine::nodes::claude::{
        ClaudeAnalyzeNode, ClaudeApplyNode, ClaudePlanNode,
    };
    use crate::test_utils::{create_test_service_provider_with_mock_claude, MockClaudeProvider};
    use serde_json::json;
    use std::sync::Arc;

    fn test_context() -> ExecutionContext {
        ExecutionContext::new(json!({}))
    }

    fn test_context_with_working_dir(dir: &str) -> ExecutionContext {
        let ctx = ExecutionContext::new(json!({}));
        ctx.set_working_dir(Some(dir.to_string()));
        ctx
    }

    fn mock_claude() -> Arc<MockClaudeProvider> {
        Arc::new(MockClaudeProvider::new())
    }

    // =========================================================================
    // ClaudeAnalyzeNode
    // =========================================================================

    // --- node_type ---

    #[test]
    fn test_claude_analyze_node_type() {
        let node = ClaudeAnalyzeNode;
        assert_eq!(node.node_type(), "claude.analyze");
    }

    // --- validate ---

    #[test]
    fn test_claude_analyze_validate_success() {
        let node = ClaudeAnalyzeNode;
        let config = json!({ "prompt": "Analyze this codebase for issues" });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn test_claude_analyze_validate_missing_prompt() {
        let node = ClaudeAnalyzeNode;
        let config = json!({});
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("prompt"),
                "Error should mention 'prompt', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_claude_analyze_validate_empty_config() {
        let node = ClaudeAnalyzeNode;
        let config = json!(null);
        assert!(node.validate(&config).is_err());
    }

    #[test]
    fn test_claude_analyze_validate_with_optional_fields() {
        let node = ClaudeAnalyzeNode;
        let config = json!({
            "prompt": "Analyze code",
            "working_dir": "/tmp/repo",
            "timeout_secs": 120
        });
        assert!(node.validate(&config).is_ok());
    }

    // --- execute: success ---

    #[tokio::test]
    async fn test_claude_analyze_execute_success() {
        let node = ClaudeAnalyzeNode;
        let config = json!({ "prompt": "Analyze the login module" });
        let mock = mock_claude();
        mock.set_default_response("Found 3 potential issues in auth module")
            .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node
            .execute("analyze-1", &config, &context, &services)
            .await
            .unwrap();

        assert_eq!(
            result["analysis"],
            "Found 3 potential issues in auth module"
        );

        let log = mock.get_call_log().await;
        assert_eq!(log.len(), 1);
        assert_eq!(log[0], "Analyze the login module");
    }

    #[tokio::test]
    async fn test_claude_analyze_execute_with_custom_response() {
        let node = ClaudeAnalyzeNode;
        let config = json!({ "prompt": "analyze security vulnerabilities" });
        let mock = mock_claude();
        mock.set_response("analyze", "No vulnerabilities found")
            .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node
            .execute("analyze-1", &config, &context, &services)
            .await
            .unwrap();

        assert_eq!(result["analysis"], "No vulnerabilities found");
    }

    #[tokio::test]
    async fn test_claude_analyze_execute_with_working_dir() {
        let node = ClaudeAnalyzeNode;
        let config = json!({ "prompt": "Analyze code" });
        let mock = mock_claude();
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context_with_working_dir("/tmp/my-repo");

        let result = node
            .execute("analyze-1", &config, &context, &services)
            .await;
        assert!(
            result.is_ok(),
            "Should succeed with working_dir set on context"
        );
    }

    #[tokio::test]
    async fn test_claude_analyze_execute_working_dir_override() {
        let node = ClaudeAnalyzeNode;
        let config = json!({
            "prompt": "Analyze code",
            "working_dir": "/tmp/override-dir"
        });
        let mock = mock_claude();
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context_with_working_dir("/tmp/original-dir");

        let result = node
            .execute("analyze-1", &config, &context, &services)
            .await;
        assert!(
            result.is_ok(),
            "Should succeed with working_dir override in config"
        );
    }

    // --- execute: failure ---

    #[tokio::test]
    async fn test_claude_analyze_execute_cli_failure() {
        let node = ClaudeAnalyzeNode;
        let config = json!({ "prompt": "Analyze this" });
        let mock = mock_claude();
        mock.set_should_fail(true, "Claude CLI not found on PATH")
            .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node
            .execute("analyze-1", &config, &context, &services)
            .await;
        assert!(
            result.is_err(),
            "Should fail when Claude CLI is unavailable"
        );
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("Claude CLI not found"),
            "Error should indicate Claude CLI issue, got: {}",
            err_msg
        );
    }

    #[tokio::test]
    async fn test_claude_analyze_execute_prompt_not_string() {
        let node = ClaudeAnalyzeNode;
        let config = json!({ "prompt": 12345 });
        let mock = mock_claude();
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node
            .execute("analyze-1", &config, &context, &services)
            .await;
        assert!(result.is_err(), "Should fail when prompt is not a string");
    }

    // --- execute: template resolution ---

    #[tokio::test]
    async fn test_claude_analyze_execute_with_template_resolution() {
        let node = ClaudeAnalyzeNode;
        let config = json!({
            "prompt": "Analyze issue: {{issue.title}}"
        });
        let mock = mock_claude();
        mock.set_default_response("Analysis of login bug complete")
            .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();
        context.set_node_output("issue".into(), json!({ "title": "Fix login bug" }));

        let result = node
            .execute("analyze-1", &config, &context, &services)
            .await
            .unwrap();

        assert_eq!(result["analysis"], "Analysis of login bug complete");

        let log = mock.get_call_log().await;
        assert_eq!(log[0], "Analyze issue: Fix login bug");
    }

    #[tokio::test]
    async fn test_claude_analyze_execute_with_missing_template_ref() {
        let node = ClaudeAnalyzeNode;
        let config = json!({
            "prompt": "Analyze: {{missing_node.data}}"
        });
        let mock = mock_claude();
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node
            .execute("analyze-1", &config, &context, &services)
            .await;
        assert!(
            result.is_err(),
            "Should fail on unresolved template reference"
        );
    }

    // =========================================================================
    // ClaudePlanNode
    // =========================================================================

    // --- node_type ---

    #[test]
    fn test_claude_plan_node_type() {
        let node = ClaudePlanNode;
        assert_eq!(node.node_type(), "claude.plan");
    }

    // --- validate ---

    #[test]
    fn test_claude_plan_validate_success() {
        let node = ClaudePlanNode;
        let config = json!({ "prompt": "Plan a solution for issue #42" });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn test_claude_plan_validate_missing_prompt() {
        let node = ClaudePlanNode;
        let config = json!({});
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("prompt"),
                "Error should mention 'prompt', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_claude_plan_validate_null_config() {
        let node = ClaudePlanNode;
        let config = json!(null);
        assert!(node.validate(&config).is_err());
    }

    #[test]
    fn test_claude_plan_validate_with_all_fields() {
        let node = ClaudePlanNode;
        let config = json!({
            "prompt": "Plan solution",
            "working_dir": "/tmp/repo",
            "timeout_secs": 300
        });
        assert!(node.validate(&config).is_ok());
    }

    // --- execute: success ---

    #[tokio::test]
    async fn test_claude_plan_execute_success() {
        let node = ClaudePlanNode;
        let config = json!({ "prompt": "Plan how to fix the auth module" });
        let mock = mock_claude();
        mock.set_default_response(
            "1. Update auth middleware\n2. Add JWT validation\n3. Write tests",
        )
        .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node
            .execute("plan-1", &config, &context, &services)
            .await
            .unwrap();

        assert!(result["plan"]
            .as_str()
            .unwrap()
            .contains("Update auth middleware"));

        let log = mock.get_call_log().await;
        assert_eq!(log.len(), 1);
        assert_eq!(log[0], "Plan how to fix the auth module");
    }

    #[tokio::test]
    async fn test_claude_plan_execute_with_working_dir_from_context() {
        let node = ClaudePlanNode;
        let config = json!({ "prompt": "Plan fix" });
        let mock = mock_claude();
        mock.set_default_response("Step 1: Fix the bug").await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context_with_working_dir("/tmp/project");

        let result = node.execute("plan-1", &config, &context, &services).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["plan"], "Step 1: Fix the bug");
    }

    #[tokio::test]
    async fn test_claude_plan_execute_output_structure() {
        let node = ClaudePlanNode;
        let config = json!({ "prompt": "Create implementation plan" });
        let mock = mock_claude();
        mock.set_default_response("The plan is ready").await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node
            .execute("plan-1", &config, &context, &services)
            .await
            .unwrap();

        // Verify output has the expected "plan" key
        assert!(
            result.get("plan").is_some(),
            "Output should contain 'plan' key"
        );
        assert!(result["plan"].is_string(), "'plan' should be a string");
    }

    // --- execute: failure ---

    #[tokio::test]
    async fn test_claude_plan_execute_cli_failure() {
        let node = ClaudePlanNode;
        let config = json!({ "prompt": "Plan something" });
        let mock = mock_claude();
        mock.set_should_fail(
            true,
            "Failed to spawn claude CLI: No such file or directory. Is 'claude' installed?",
        )
        .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node.execute("plan-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail when Claude CLI is unavailable"
        );
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("claude"),
            "Error should mention claude CLI, got: {}",
            err_msg
        );
    }

    #[tokio::test]
    async fn test_claude_plan_execute_timeout_simulation() {
        let node = ClaudePlanNode;
        let config = json!({
            "prompt": "Plan complex solution",
            "timeout_secs": 1
        });
        let mock = mock_claude();
        mock.set_should_fail(true, "Operation timed out").await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node.execute("plan-1", &config, &context, &services).await;
        assert!(result.is_err(), "Should fail on timeout");
    }

    #[tokio::test]
    async fn test_claude_plan_execute_prompt_not_string() {
        let node = ClaudePlanNode;
        let config = json!({ "prompt": ["not", "a", "string"] });
        let mock = mock_claude();
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node.execute("plan-1", &config, &context, &services).await;
        assert!(result.is_err(), "Should fail when prompt is not a string");
    }

    // --- execute: template resolution ---

    #[tokio::test]
    async fn test_claude_plan_execute_with_template_resolution() {
        let node = ClaudePlanNode;
        let config = json!({
            "prompt": "Plan fix for issue #{{issue.number}}: {{issue.title}}"
        });
        let mock = mock_claude();
        mock.set_default_response("Plan: fix the authentication bug")
            .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();
        context.set_node_output("issue".into(), json!({ "number": 42, "title": "Auth bug" }));

        let result = node
            .execute("plan-1", &config, &context, &services)
            .await
            .unwrap();

        assert_eq!(result["plan"], "Plan: fix the authentication bug");

        let log = mock.get_call_log().await;
        assert_eq!(log[0], "Plan fix for issue #42: Auth bug");
    }

    #[tokio::test]
    async fn test_claude_plan_execute_with_missing_template_ref() {
        let node = ClaudePlanNode;
        let config = json!({
            "prompt": "Plan for {{nonexistent.data}}"
        });
        let mock = mock_claude();
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node.execute("plan-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail on unresolved template reference"
        );
    }

    // =========================================================================
    // ClaudeApplyNode
    // =========================================================================

    // --- node_type ---

    #[test]
    fn test_claude_apply_node_type() {
        let node = ClaudeApplyNode;
        assert_eq!(node.node_type(), "claude.apply");
    }

    // --- validate ---

    #[test]
    fn test_claude_apply_validate_success() {
        let node = ClaudeApplyNode;
        let config = json!({ "prompt": "Apply the fix from the plan" });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn test_claude_apply_validate_missing_prompt() {
        let node = ClaudeApplyNode;
        let config = json!({});
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("prompt"),
                "Error should mention 'prompt', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_claude_apply_validate_null_config() {
        let node = ClaudeApplyNode;
        let config = json!(null);
        assert!(node.validate(&config).is_err());
    }

    #[test]
    fn test_claude_apply_validate_with_all_fields() {
        let node = ClaudeApplyNode;
        let config = json!({
            "prompt": "Apply the solution",
            "working_dir": "/tmp/repo",
            "timeout_secs": 600
        });
        assert!(node.validate(&config).is_ok());
    }

    // --- execute: success ---

    #[tokio::test]
    async fn test_claude_apply_execute_success() {
        let node = ClaudeApplyNode;
        let config = json!({ "prompt": "Implement the authentication fix" });
        let mock = mock_claude();
        mock.set_default_response("Applied changes to 3 files successfully")
            .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node
            .execute("apply-1", &config, &context, &services)
            .await
            .unwrap();

        assert_eq!(result["output"], "Applied changes to 3 files successfully");
        assert_eq!(result["success"], true);

        let log = mock.get_call_log().await;
        assert_eq!(log.len(), 1);
        assert_eq!(log[0], "Implement the authentication fix");
    }

    #[tokio::test]
    async fn test_claude_apply_execute_output_structure() {
        let node = ClaudeApplyNode;
        let config = json!({ "prompt": "Apply changes" });
        let mock = mock_claude();
        mock.set_default_response("Done").await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node
            .execute("apply-1", &config, &context, &services)
            .await
            .unwrap();

        // Verify output has both expected keys
        assert!(
            result.get("output").is_some(),
            "Output should contain 'output' key"
        );
        assert!(
            result.get("success").is_some(),
            "Output should contain 'success' key"
        );
        assert!(result["output"].is_string(), "'output' should be a string");
        assert!(
            result["success"].is_boolean(),
            "'success' should be a boolean"
        );
        assert_eq!(result["success"], true);
    }

    #[tokio::test]
    async fn test_claude_apply_execute_with_working_dir() {
        let node = ClaudeApplyNode;
        let config = json!({ "prompt": "Apply fix" });
        let mock = mock_claude();
        mock.set_default_response("Changes applied").await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context_with_working_dir("/tmp/my-project");

        let result = node.execute("apply-1", &config, &context, &services).await;
        assert!(result.is_ok(), "Should succeed with working_dir on context");
        assert_eq!(result.unwrap()["output"], "Changes applied");
    }

    #[tokio::test]
    async fn test_claude_apply_execute_with_working_dir_override() {
        let node = ClaudeApplyNode;
        let config = json!({
            "prompt": "Apply fix",
            "working_dir": "/tmp/override"
        });
        let mock = mock_claude();
        mock.set_default_response("Applied in override dir").await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context_with_working_dir("/tmp/original");

        let result = node.execute("apply-1", &config, &context, &services).await;
        assert!(result.is_ok());
    }

    // --- execute: failure ---

    #[tokio::test]
    async fn test_claude_apply_execute_cli_failure() {
        let node = ClaudeApplyNode;
        let config = json!({ "prompt": "Apply changes" });
        let mock = mock_claude();
        mock.set_should_fail(
            true,
            "Failed to spawn claude CLI: No such file or directory. Is 'claude' installed?",
        )
        .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node.execute("apply-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail when Claude CLI is unavailable"
        );
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("claude"),
            "Error should mention claude CLI, got: {}",
            err_msg
        );
    }

    #[tokio::test]
    async fn test_claude_apply_execute_process_failure() {
        let node = ClaudeApplyNode;
        let config = json!({ "prompt": "Apply breaking changes" });
        let mock = mock_claude();
        mock.set_should_fail(true, "Claude CLI failed: exit code 1")
            .await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node.execute("apply-1", &config, &context, &services).await;
        assert!(result.is_err(), "Should propagate CLI process failure");
    }

    #[tokio::test]
    async fn test_claude_apply_execute_timeout_simulation() {
        let node = ClaudeApplyNode;
        let config = json!({
            "prompt": "Apply very complex changes",
            "timeout_secs": 1
        });
        let mock = mock_claude();
        mock.set_should_fail(true, "Operation timed out").await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node.execute("apply-1", &config, &context, &services).await;
        assert!(result.is_err(), "Should fail on timeout");
    }

    #[tokio::test]
    async fn test_claude_apply_execute_prompt_not_string() {
        let node = ClaudeApplyNode;
        let config = json!({ "prompt": { "nested": "object" } });
        let mock = mock_claude();
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node.execute("apply-1", &config, &context, &services).await;
        assert!(result.is_err(), "Should fail when prompt is not a string");
    }

    // --- execute: template resolution ---

    #[tokio::test]
    async fn test_claude_apply_execute_with_template_resolution() {
        let node = ClaudeApplyNode;
        let config = json!({
            "prompt": "Apply the following plan:\n{{plan.plan}}"
        });
        let mock = mock_claude();
        mock.set_default_response("All changes applied").await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();
        context.set_node_output(
            "plan".into(),
            json!({ "plan": "1. Fix auth\n2. Add tests" }),
        );

        let result = node
            .execute("apply-1", &config, &context, &services)
            .await
            .unwrap();

        assert_eq!(result["output"], "All changes applied");
        assert_eq!(result["success"], true);

        let log = mock.get_call_log().await;
        assert_eq!(
            log[0],
            "Apply the following plan:\n1. Fix auth\n2. Add tests"
        );
    }

    #[tokio::test]
    async fn test_claude_apply_execute_with_missing_template_ref() {
        let node = ClaudeApplyNode;
        let config = json!({
            "prompt": "Apply: {{nonexistent.plan}}"
        });
        let mock = mock_claude();
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        let result = node.execute("apply-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail on unresolved template reference"
        );
    }

    // =========================================================================
    // Cross-node integration: verifying outputs can be chained
    // =========================================================================

    #[tokio::test]
    async fn test_claude_nodes_can_chain_outputs() {
        let mock = mock_claude();
        mock.set_response("Analyze", "Found bug in auth module")
            .await;
        mock.set_response("Plan", "1. Fix validateToken\n2. Add tests")
            .await;
        mock.set_response("Apply", "Fixed 2 files").await;
        let services = create_test_service_provider_with_mock_claude(mock.clone());
        let context = test_context();

        // Step 1: Analyze
        let analyze_node = ClaudeAnalyzeNode;
        let analyze_config = json!({ "prompt": "Analyze the auth module" });
        let analyze_result = analyze_node
            .execute("analyze-1", &analyze_config, &context, &services)
            .await
            .unwrap();
        context.set_node_output("analyze-1".into(), analyze_result.clone());

        assert_eq!(analyze_result["analysis"], "Found bug in auth module");

        // Step 2: Plan (references analyze output)
        let plan_node = ClaudePlanNode;
        let plan_config = json!({
            "prompt": "Plan a fix based on: {{analyze-1.analysis}}"
        });
        let plan_result = plan_node
            .execute("plan-1", &plan_config, &context, &services)
            .await
            .unwrap();
        context.set_node_output("plan-1".into(), plan_result.clone());

        assert!(plan_result["plan"]
            .as_str()
            .unwrap()
            .contains("Fix validateToken"));

        // Step 3: Apply (references plan output)
        let apply_node = ClaudeApplyNode;
        let apply_config = json!({
            "prompt": "Apply this plan: {{plan-1.plan}}"
        });
        let apply_result = apply_node
            .execute("apply-1", &apply_config, &context, &services)
            .await
            .unwrap();

        assert_eq!(apply_result["output"], "Fixed 2 files");
        assert_eq!(apply_result["success"], true);

        // Verify all three prompts were sent
        let log = mock.get_call_log().await;
        assert_eq!(log.len(), 3);
        assert!(log[0].contains("Analyze"));
        assert!(log[1].contains("Plan a fix based on: Found bug in auth module"));
        assert!(log[2].contains("Apply this plan: 1. Fix validateToken"));
    }
}
