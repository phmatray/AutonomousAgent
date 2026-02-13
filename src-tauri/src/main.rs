// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod errors;
mod models;
mod services;
#[cfg(test)]
mod test_utils;

use services::AppState;
use std::sync::mpsc;
use std::sync::Arc;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .setup(|app| {
            let app_handle = app.handle().clone();

            let state = app.state::<AppState>();
            let github_client = Arc::clone(&state.github);
            let github_restore = state.github.clone_for_restore();
            let git_service = Arc::clone(&state.git);
            let storage_service = state.inner().storage.clone();

            let engine_db = state.inner().engine.db_pool_handle();
            let engine_svc = state.inner().engine.services_handle();
            let engine = Arc::clone(&state.engine);
            let init_state = Arc::clone(&state.initialization);

            // Block setup() until database + credential restoration initialization completes.
            let (init_tx, init_rx) = mpsc::channel::<()>();

            tauri::async_runtime::spawn(async move {
                engine.set_app_handle(app_handle.clone()).await;
                match db::init_database(&app_handle).await {
                    Ok(pool) => {
                        *engine_db.write().await = Some(pool);
                        *engine_svc.write().await =
                            Some(services::workflow_engine::node_registry::ServiceProvider {
                                github: github_client,
                                storage: Arc::new(storage_service.clone()),
                                claude: Arc::new(
                                    services::workflow_engine::node_registry::ClaudeProvider::new(),
                                ),
                                git: git_service,
                                backlog: Arc::new(services::BacklogService::new(engine_db.clone())),
                            });
                        init_state.write().await.database = true;
                        println!("Workflow engine initialized successfully");

                        if let Ok(api_key) = storage_service.get_claude_api_key().await {
                            std::env::set_var("ANTHROPIC_API_KEY", api_key);
                        }

                        if let Ok(token) = storage_service.get_github_token().await {
                            if let Err(e) = github_restore.authenticate(&token).await {
                                eprintln!("Failed to restore GitHub session: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize database: {}", e);
                    }
                }

                init_state.write().await.github_auth_attempted = true;
                let _ = init_tx.send(());
            });

            let _ = init_rx.recv();
            println!("All initialization complete (database + auth)");

            let scheduler_engine = Arc::clone(&state.engine);
            tauri::async_runtime::spawn(async move {
                if let Err(error) = scheduler_engine.start_scheduler_runtime().await {
                    eprintln!("Failed to start scheduler runtime: {}", error);
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
            commands::workflow::preflight_workflow,
            commands::workflow::execute_workflow,
            commands::workflow::cancel_workflow_execution,
            commands::workflow::list_executions,
            commands::workflow::get_execution_logs,
            commands::workflow::copy_debug_bundle,
            // GitHub commands
            commands::github::authenticate_github,
            commands::github::list_github_credentials,
            commands::github::list_repositories,
            commands::github::list_issues,
            commands::github::create_pull_request,
            commands::github::get_auth_status,
            commands::github::get_saved_github_token,
            commands::github::delete_github_token,
            commands::github::delete_github_credential,
            commands::github::verify_github_token,
            commands::github::list_credential_audit_events,
            // Claude commands
            commands::claude::execute_plan,
            commands::claude::cancel_execution,
            commands::claude::list_running_executions,
            commands::claude::get_claude_credential_status,
            commands::claude::save_claude_credential,
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
            // Backlog commands
            commands::backlog::list_backlog_items,
            commands::backlog::sync_github_issues_to_backlog,
            commands::backlog::link_backlog_to_workflow,
            commands::backlog::create_linked_workflow_from_backlog,
            commands::backlog::delete_backlog_item,
            commands::backlog::update_backlog_item_triage,
            commands::backlog::bulk_update_backlog_triage,
            // System commands
            commands::system::is_initialized,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
