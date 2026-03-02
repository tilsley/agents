export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  weight: number;
}

export interface ReviewChecklist {
  taskType: string;
  items: ChecklistItem[];
}
