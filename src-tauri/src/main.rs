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

            // --- GitHub session restoration (blocking - must complete before app is ready) ---
            let init_state_gh = Arc::clone(&state.initialization);
            let (auth_tx, auth_rx) = mpsc::channel::<()>();

            if let Ok(token) = state.storage.get_github_token() {
                let github = state.github.clone_for_restore();
                let auth_tx_task = auth_tx.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = github.authenticate(&token).await {
                        eprintln!("Failed to restore GitHub session: {}", e);
                    }
                    init_state_gh.write().await.github_auth_attempted = true;
                    let _ = auth_tx_task.send(());
                });
            } else {
                // No token stored, mark as attempted and signal immediately
                let auth_tx_task = auth_tx.clone();
                tauri::async_runtime::spawn(async move {
                    init_state_gh.write().await.github_auth_attempted = true;
                    let _ = auth_tx_task.send(());
                });
            }
            drop(auth_tx);

            // --- Database initialization (blocking - must complete before app is ready) ---
            let github_client = Arc::clone(&state.github);
            let git_service = Arc::clone(&state.git);

            let engine_db = state.inner().engine.db_pool_handle();
            let engine_svc = state.inner().engine.services_handle();
            let init_state_db = Arc::clone(&state.initialization);

            // Use Notify to block setup() until DB initialization completes
            let (db_tx, db_rx) = mpsc::channel::<()>();

            tauri::async_runtime::spawn(async move {
                match db::init_database(&app_handle).await {
                    Ok(pool) => {
                        *engine_db.write().await = Some(pool);
                        *engine_svc.write().await =
                            Some(services::workflow_engine::node_registry::ServiceProvider {
                                github: github_client,
                                storage: Arc::new(services::StorageService::new()),
                                claude: Arc::new(
                                    services::workflow_engine::node_registry::ClaudeProvider::new(),
                                ),
                                git: git_service,
                            });
                        init_state_db.write().await.database = true;
                        println!("Workflow engine initialized successfully");
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize database: {}", e);
                    }
                }
                // Signal that DB initialization attempt is done (success or failure)
                let _ = db_tx.send(());
            });

            // Block setup until both DB and GitHub auth initialization complete.
            // Both run in parallel via spawned tasks, but setup() waits for both.
            let _ = db_rx.recv();
            let _ = auth_rx.recv();
            println!("All initialization complete (database + auth)");

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
            // Backlog commands
            commands::backlog::list_backlog_items,
            commands::backlog::sync_github_issues_to_backlog,
            commands::backlog::link_backlog_to_workflow,
            commands::backlog::delete_backlog_item,
            // System commands
            commands::system::is_initialized,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
