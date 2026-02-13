use crate::errors::Result;
use crate::models::Workflow;

#[tauri::command]
pub async fn list_workflows() -> Result<Vec<Workflow>> {
    // TODO: Implement
    Ok(vec![])
}

#[tauri::command]
pub async fn get_workflow(id: String) -> Result<Option<Workflow>> {
    // TODO: Implement
    Ok(None)
}

#[tauri::command]
pub async fn create_workflow(workflow: Workflow) -> Result<Workflow> {
    // TODO: Implement
    Ok(workflow)
}

#[tauri::command]
pub async fn update_workflow(id: String, workflow: Workflow) -> Result<Workflow> {
    // TODO: Implement
    Ok(workflow)
}

#[tauri::command]
pub async fn delete_workflow(id: String) -> Result<()> {
    // TODO: Implement
    Ok(())
}
