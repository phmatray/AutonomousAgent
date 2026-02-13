// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod errors;
mod models;
mod services;

use services::AppState;
use std::sync::Arc;
use tauri::Manager;

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Try to restore GitHub session from stored token
            let state = app.state::<AppState>();
            if let Ok(token) = state.storage.get_github_token() {
                let github = state.github.clone_for_restore();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = github.authenticate(&token).await {
                        eprintln!("Failed to restore GitHub session: {}", e);
                    }
                });
            }

            // Initialize database and workflow engine
            let state_ref = app.state::<AppState>();
            let github_client = Arc::new(services::GitHubClient::new());
            let git_service = Arc::new(services::GitService::new());

            // We need references to pass into the async block
            let engine_db = state_ref.inner().engine.db_pool_handle();
            let engine_svc = state_ref.inner().engine.services_handle();

            tauri::async_runtime::spawn(async move {
                match db::init_database(&app_handle).await {
                    Ok(pool) => {
                        // Initialize the workflow engine with the database pool
                        *engine_db.write().await = Some(pool);
                        *engine_svc.write().await = Some(
                            services::workflow_engine::node_registry::ServiceProvider {
                                github: github_client,
                                claude: Arc::new(
                                    services::workflow_engine::node_registry::ClaudeProvider::new(),
                                ),
                                git: git_service,
                            },
                        );
                        println!("Workflow engine initialized successfully");
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize database: {}", e);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Workflow commands
            commands::workflow::list_workflows,
            commands::workflow::get_workflow,
            commands::workflow::create_workflow,
            commands::workflow::update_workflow,
            commands::workflow::delete_workflow,
            commands::workflow::execute_workflow,
            commands::workflow::list_executions,
            commands::workflow::get_execution_logs,
            // GitHub commands
            commands::github::authenticate_github,
            commands::github::list_repositories,
            commands::github::list_issues,
            commands::github::create_pull_request,
            commands::github::get_auth_status,
            // Claude commands
            commands::claude::execute_plan,
            commands::claude::cancel_execution,
            commands::claude::list_running_executions,
            // Git commands
            commands::git::git_status,
            commands::git::git_log,
            commands::git::git_diff,
            commands::git::git_create_worktree,
            commands::git::git_list_worktrees,
            commands::git::git_remove_worktree,
            commands::git::git_commit,
            commands::git::git_push,
            commands::git::git_pull,
            commands::git::git_clone,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
