import { IInputs, IOutputs } from "./generated/ManifestTypes";
import "./css/KanbanBoard.css";

interface Task {
    id: string;
    dvId?: string;

    title: string;
    status: string;

    assignee: string;
    assigneeId?: string;

    reviewedBy?: string;
    estimate?: string;
    completionDate?: string;

    deadline: string;          // due date (yyyy-mm-dd)
    startDate?: string;        // yyyy-mm-dd

    priority?: string;         // e.g. "low" | "medium" | "high"
    progressState?: string;    // "not started" | "in progress" | "completed"

    description?: string;


    // keep this because you already have it in your JSON
    progress: string;
    order?: number;
}

interface KanbanContext {
    parameters: IInputs;
}

export class KanbanBoard {
    private _languageCode: "EN" | "PL" = "EN";

    private _labels = {
        EN: {
            addTaskInline: "+ Add task",
            addTaskButton: "Add task",
            addBucket: "+ Add a new bucket",
            enterTaskName: "Enter task name*",
            setDueDate: "Set due date",
            assign: "Assign",
            assignTo: "Assign to:",
            deadline: "Deadline:",
            dropHereBottom: "Drop here to place at bottom",
            status: "Status",
            bucket: "Bucket",
            startDate: "Start date",
            endDate: "End date",
            notes: "Notes",
            notesPlaceholder: "Type a description or add notes here",
            deleteTaskTitle: "Delete task?",
            deleteTaskMessage: 'Are you sure you want to delete "{0}"? The deletion will be applied after you click Next.',
            cancel: "Cancel",
            delete: "Delete",
            moveTask: "Move task",
            rename: "Rename",
            copy: "Copy",
            unassigned: "Unassigned",
            searchAssignee: "Type a name or email address",
            notStarted: "Not started",
            inProgress: "In progress",
            completed: "Completed",
            newBucket: "New bucket",
            deleteBucketBlocked: "This bucket contains tasks. Move or delete them first."
        },
        PL: {
            addTaskInline: "+ Dodaj zadanie",
            addTaskButton: "Dodaj zadanie",
            addBucket: "+ Dodaj nowy bucket",
            enterTaskName: "Wpisz nazwę zadania*",
            setDueDate: "Ustaw termin",
            assign: "Przypisz",
            assignTo: "Przypisano do:",
            deadline: "Termin:",
            dropHereBottom: "Upuść tutaj, aby umieścić na końcu",
            status: "Status",
            bucket: "Bucket",
            startDate: "Data rozpoczęcia",
            endDate: "Data zakończenia",
            notes: "Notatki",
            notesPlaceholder: "Wpisz opis lub dodaj notatki tutaj",
            deleteTaskTitle: "Usunąć zadanie?",
            deleteTaskMessage: 'Czy na pewno chcesz usunąć "{0}"? Usunięcie zostanie zastosowane po kliknięciu Dalej.',
            cancel: "Anuluj",
            delete: "Usuń",
            moveTask: "Przenieś zadanie",
            rename: "Zmień nazwę",
            copy: "Kopiuj",
            unassigned: "Nieprzypisane",
            searchAssignee: "Wpisz imię lub adres e-mail",
            notStarted: "Nie rozpoczęto",
            inProgress: "W toku",
            completed: "Ukończono",
            newBucket: "Nowy bucket",
            deleteBucketBlocked: "Ten bucket zawiera zadania. Najpierw je przenieś lub usuń."
        }
    };

    private t(key: keyof typeof this._labels.EN): string {
        return this._labels[this._languageCode][key] || this._labels.EN[key];
    }

    private sanitizeHtml(html: string): string {
        const template = document.createElement("template");
        template.innerHTML = html;

        const allowedTags = new Set([
            "P", "BR", "STRONG", "B", "EM", "I",
            "U", "S", "UL", "OL", "LI",
            "H1", "H2", "H3", "H4", "BLOCKQUOTE",
            "A"
        ]);

        const walker = document.createTreeWalker(
            template.content,
            NodeFilter.SHOW_ELEMENT
        );

        const elements: Element[] = [];
        let current = walker.nextNode();

        while (current) {
            elements.push(current as Element);
            current = walker.nextNode();
        }

        elements.forEach((element) => {
            if (!allowedTags.has(element.tagName)) {
                element.replaceWith(...Array.from(element.childNodes));
                return;
            }

            // Remove every attribute except the safe link attributes.
            Array.from(element.attributes).forEach((attribute) => {
                if (
                    element.tagName === "A" &&
                    (attribute.name === "href" ||
                        attribute.name === "target" ||
                        attribute.name === "rel")
                ) {
                    return;
                }

                element.removeAttribute(attribute.name);
            });

            if (element.tagName === "A") {
                const href = element.getAttribute("href") || "";

                // Only allow normal web links.
                if (
                    !href.startsWith("https://") &&
                    !href.startsWith("http://")
                ) {
                    element.removeAttribute("href");
                } else {
                    element.setAttribute("target", "_blank");
                    element.setAttribute("rel", "noopener noreferrer");
                }
            }
        });

        return template.innerHTML;
    }

    private _container!: HTMLDivElement;
    private _notifyOutputChanged!: () => void;
    private _readOnly = false;

    private _tasks: Task[] = [];

    private _draggedTaskId: string | null = null;
    private _movedTaskId: string | null = null;
    private _newStatus: string | null = null;
    private _activeMoveSubmenu: string | null = null;
    private _activeAssignSubmenu: string | null = null;
    private _openTaskId = "";
    private _lastOpenedTaskId = "";

    private _addTaskRequested: string | null = null;
    private _addTaskStatus: string | null = null;
    private _activeTaskMenu: string | null = null;
    private _lastTasksJson: string | null = null;
    private _assignModalTaskId: string | null = null;
    private _assignSearchText = "";
    private _flashTaskId: string | null = null;
    private _flashTimer: number | null = null;
    private _taskModalTaskId: string | null = null;
    private _taskDraft: Partial<Task> | null = null;
    private _dropTargetId: string | null = null;
    private _dropPlaceAfter = false;
    private _confirmDeleteTaskId: string | null = null;
    private _confirmDeleteTaskTitle = "";


    private _activeCreateStatus: string | null = null;
    private _newTaskTitle = "";
    private _newTaskDeadline = "";
    private _newTaskAssigneeId = "";
    private _newTaskAssigneeName = "";
    private _users: { id: string; name: string; photo?: string }[] = [];
    private _lastUsersJson: string | null = null;

    private _activeBucketMenu: string | null = null;
    private _renamingBucket: string | null = null;

    private _buckets: { id: string; name: string; order: number }[] = [];
    private _lastBucketsJson: string | null = null;





    constructor() {
        // required by PCF
    }

    public init(
        context: KanbanContext,
        notifyOutputChanged: () => void,
        state: unknown,
        container: HTMLDivElement
    ): void {
        this._container = document.createElement("div");
        container.appendChild(this._container);
        this._notifyOutputChanged = notifyOutputChanged;
        document.addEventListener("click", this.handleDocumentClick);
    }

    private normalizeBucketOrder(bucketId: string): void {
        const bucketTasks = this._tasks
            .filter(t => (t.status || "").toLowerCase() === bucketId.toLowerCase())
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        // renumber in nice gaps so future inserts are easy
        bucketTasks.forEach((t, i) => (t.order = (i + 1) * 10));
    }

    private closeTaskModal(save: boolean): void {
        if (!this._readOnly && save && this._taskModalTaskId && this._taskDraft) {
            const id = this._taskModalTaskId;
            const idx = this._tasks.findIndex(t => t.id === id);

            if (idx >= 0) {
                const beforeStatus = this._tasks[idx].status;

                // commit draft -> real task
                this._tasks[idx] = {
                    ...this._tasks[idx],
                    ...this._taskDraft
                } as Task;

                const afterStatus = this._tasks[idx].status;

                // keep order sane
                if (beforeStatus !== afterStatus) {
                    this.normalizeBucketOrder(beforeStatus);
                    this.normalizeBucketOrder(afterStatus);
                } else {
                    this.normalizeBucketOrder(afterStatus);
                }

                // outputs for Power Apps
                this._movedTaskId = id;
                this._newStatus = afterStatus;
                this._notifyOutputChanged();
            }
        }

        // close any inline assign UI
        this._assignModalTaskId = null;
        this._assignSearchText = "";

        // close modal + clear draft
        this._taskModalTaskId = null;
        this._taskDraft = null;
        this.updateViewSafe();
    }

    private handleDocumentClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement;

        if (!target.closest(".bucket-header") &&
            !target.closest(".task-header")) {

            let changed = false;

            if (this._activeBucketMenu !== null) {
                this._activeBucketMenu = null;
                changed = true;
            }

            if (this._activeTaskMenu !== null) {
                this._activeTaskMenu = null;
                changed = true;
            }

            if (changed) {
                this.updateViewSafe();
            }
        }
    };

    private _latestContext: KanbanContext | null = null;


    private updateViewSafe(): void {
        if (this._latestContext) {
            this.updateView(this._latestContext);
        }
    }

    private renderDeleteConfirmModal(context: KanbanContext): void {
        const overlay = document.createElement("div");
        overlay.className = "confirm-overlay";

        const modal = document.createElement("div");
        modal.className = "confirm-modal";

        const title = document.createElement("div");
        title.className = "confirm-title";
        title.innerText = this.t("deleteTaskTitle");

        const msg = document.createElement("div");
        const msgTemplate = this.t("deleteTaskMessage");
        msg.className = "confirm-message";
        msg.innerText = msgTemplate.replace("{0}", this._confirmDeleteTaskTitle || "");

        const actions = document.createElement("div");
        actions.className = "confirm-actions";

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "confirm-btn confirm-secondary";
        cancelBtn.innerText = this.t("cancel");
        cancelBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this._confirmDeleteTaskId = null;
            this._confirmDeleteTaskTitle = "";
            this.updateViewSafe();
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "confirm-btn confirm-danger";
        deleteBtn.innerText = this.t("delete");
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();

            const id = this._confirmDeleteTaskId!;
            this._tasks = this._tasks.filter(t => t.id !== id);

            // notify Power Apps (so Next button saves deletes)
            this._movedTaskId = id;
            this._newStatus = "deleted";
            this._notifyOutputChanged();

            this._confirmDeleteTaskId = null;
            this._confirmDeleteTaskTitle = "";

            this.updateViewSafe();
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(deleteBtn);

        modal.appendChild(title);
        modal.appendChild(msg);
        modal.appendChild(actions);

        // click outside closes
        overlay.addEventListener("click", () => {
            this._confirmDeleteTaskId = null;
            this._confirmDeleteTaskTitle = "";
            this.updateViewSafe();
        });

        // stop inside clicks
        modal.addEventListener("click", (e) => e.stopPropagation());

        overlay.appendChild(modal);
        this._container.appendChild(overlay);
    }

    private moveTaskRelative(draggedId: string, targetId: string, placeAfter: boolean, targetBucketId: string): void {
        if (draggedId === targetId) return;

        const draggedIndex = this._tasks.findIndex(t => t.id === draggedId);
        const targetIndex = this._tasks.findIndex(t => t.id === targetId);
        if (draggedIndex < 0 || targetIndex < 0) return;

        const draggedTask = this._tasks[draggedIndex];

        // ensure correct bucket/status
        draggedTask.status = targetBucketId;

        // remove dragged item
        this._tasks.splice(draggedIndex, 1);

        // target index may change after removal
        const newTargetIndex = this._tasks.findIndex(t => t.id === targetId);
        if (newTargetIndex < 0) {
            this._tasks.push(draggedTask);
            return;
        }

        const insertIndex = placeAfter ? newTargetIndex + 1 : newTargetIndex;
        this._tasks.splice(insertIndex, 0, draggedTask);

        // outputs (bucket moved still matters)
        this.normalizeBucketOrder(targetBucketId);
        this._movedTaskId = draggedTask.id;
        this._newStatus = targetBucketId;
        this._notifyOutputChanged();
    }

    public updateView(context: KanbanContext): void {
        this._latestContext = context;

        const rawLanguage = (context.parameters.languageCode.raw || "EN").toUpperCase();
        this._languageCode = rawLanguage === "PL" ? "PL" : "EN";

        this._readOnly = context.parameters.readOnly.raw === "true";

        const tasksInput = context.parameters.tasksJson.raw;

        const openTaskInput = context.parameters.openTaskId.raw;
        this._openTaskId = (openTaskInput || "").trim();

        if (tasksInput && tasksInput !== this._lastTasksJson) {
            try {
                this._tasks = JSON.parse(tasksInput) as Task[];
                this._lastTasksJson = tasksInput;

                this._activeCreateStatus = null;
                this._newTaskTitle = "";
                this._newTaskDeadline = "";
                this._newTaskAssigneeName = "";
                this._newTaskAssigneeId = "";

                this._activeTaskMenu = null;
                this._activeMoveSubmenu = null;
                this._assignModalTaskId = null;

                this._taskModalTaskId = null;
                this._taskDraft = null;

                this._confirmDeleteTaskId = null;
                this._confirmDeleteTaskTitle = "";

                if (!this._openTaskId) {
                    this._lastOpenedTaskId = "";
                }
            } catch {
                this._tasks = [];
            }
        }

        if (
            this._openTaskId &&
            this._openTaskId !== this._lastOpenedTaskId
        ) {
            const taskToOpen = this._tasks.find(
                t => String(t.dvId || t.id) === this._openTaskId
            );

            if (taskToOpen) {
                this._taskModalTaskId = taskToOpen.id;
                this._taskDraft = {
                    ...taskToOpen,
                    startDate: taskToOpen.startDate || "",
                    deadline: taskToOpen.deadline || "",
                    priority: taskToOpen.priority || "",
                    progressState: taskToOpen.progressState || "not started",
                    description: taskToOpen.description || ""
                };

                this._lastOpenedTaskId = this._openTaskId;
            }
        }






        const usersInput = context.parameters.usersJson.raw;

        if (usersInput && usersInput !== this._lastUsersJson) {
            try {
                this._users = JSON.parse(usersInput);
                this._lastUsersJson = usersInput;
            } catch {
                this._users = [];
            }
        }

        // ===== BUCKET =====
        const bucketsInput = context.parameters.bucketsJson.raw;

        if (bucketsInput && bucketsInput !== this._lastBucketsJson) {
            try {
                interface BucketIn {
                    id: string;
                    name: string;
                    order?: number;
                }

                const parsed = JSON.parse(bucketsInput) as BucketIn[];

                this._buckets = (parsed || [])
                    .filter(b => !!b && !!b.id && !!b.name)
                    .map((b, idx) => ({
                        id: String(b.id),
                        name: String(b.name),
                        order: typeof b.order === "number" ? b.order : idx
                    }))
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

                this._lastBucketsJson = bucketsInput;
            } catch {
                this._buckets = [];
            }
        }

        this._container.innerHTML = "";

        // Ensure overlays are positioned relative to the PCF container (Power Apps safe)
        this._container.style.position = "relative";

        const board = document.createElement("div");
        board.className = "board";

        const createColumn = (bucket: { id: string; name: string }) => {

            const column = document.createElement("div");
            column.className = "column";

            column.addEventListener("click", () => {
                if (this._activeCreateStatus) {
                    this._activeCreateStatus = null;
                    this._newTaskTitle = "";
                    this._newTaskDeadline = "";
                    this._newTaskAssigneeName = "";
                    this._newTaskAssigneeId = "";
                    this.updateViewSafe();
                }
            });

            // ================= DRAG & DROP =================
            column.addEventListener("dragover", (e) => e.preventDefault());

            column.addEventListener("drop", (e) => {
                e.preventDefault();

                if (!this._draggedTaskId) return;

                const task = this._tasks.find(t => t.id === this._draggedTaskId);
                if (task) {
                    const fromBucket = task.status;
                    task.status = bucket.id;

                    // put at end
                    const bucketTasks = this._tasks.filter(t =>
                        (t.status || "").toLowerCase() === bucket.id.toLowerCase()
                    );
                    task.order = bucketTasks.length * 10;

                    this.normalizeBucketOrder(bucket.id);
                    if (fromBucket && fromBucket !== bucket.id) this.normalizeBucketOrder(fromBucket);

                    this._movedTaskId = task.id;
                    this._newStatus = bucket.id;
                    this._notifyOutputChanged();
                }

                this._draggedTaskId = null;
                this.updateViewSafe();
            });

            // ================= HEADER =================
            const headerRow = document.createElement("div");
            headerRow.className = "bucket-header";

            if (this._renamingBucket === bucket.id) {

                const renameInput = document.createElement("input");
                renameInput.className = "bucket-rename-input";
                renameInput.value = bucket.name;

                renameInput.addEventListener("blur", () => {
                    const index = this._buckets.findIndex(b => b.id === bucket.id);
                    if (index > -1) {
                        this._buckets[index].name = renameInput.value;
                    }
                    this._renamingBucket = null;

                    this._notifyOutputChanged();   // ✅ THIS is the missing piece
                    this.updateView(context);
                });

                headerRow.appendChild(renameInput);

            } else {
                const titleWrapper = document.createElement("div");
                titleWrapper.className = "bucket-title-wrapper";

                const dot = document.createElement("span");
                dot.className = "bucket-status-dot";

                const title = document.createElement("div");
                title.className = "column-title";
                title.innerText = bucket.name;

                titleWrapper.appendChild(dot);
                titleWrapper.appendChild(title);
                headerRow.appendChild(titleWrapper);
            }

            const menuButton = document.createElement("div");
            menuButton.className = "bucket-menu-button";
            menuButton.innerText = "⋯";

            menuButton.addEventListener("click", (e) => {
                e.stopPropagation();
                this._activeBucketMenu =
                    this._activeBucketMenu === bucket.id ? null : bucket.id;
                this.updateView(context);
            });

            if (!this._readOnly) {
                headerRow.appendChild(menuButton);
            }
            column.appendChild(headerRow);

            if (this._activeBucketMenu === bucket.id) {

                const dropdown = document.createElement("div");
                dropdown.className = "bucket-dropdown";

                const renameOption = document.createElement("div");
                renameOption.innerText = this.t("rename");
                renameOption.className = "bucket-dropdown-item";
                renameOption.addEventListener("click", () => {
                    this._renamingBucket = bucket.id;
                    this._activeBucketMenu = null;
                    this.updateView(context);
                });

                const deleteOption = document.createElement("div");
                deleteOption.innerText = this.t("delete");
                deleteOption.className = "bucket-dropdown-item";
                deleteOption.addEventListener("click", () => {

                    const hasTasks = this._tasks.some(t => t.status === bucket.id);

                    if (hasTasks) {
                        alert("This bucket contains tasks. Move or delete them first.");
                        this._activeBucketMenu = null;
                        this.updateView(context);
                        return;
                    }

                    this._buckets = this._buckets.filter(b => b.id !== bucket.id);

                    this._activeBucketMenu = null;

                    this._notifyOutputChanged();   // 🔴 REQUIRED
                    this.updateView(context);
                });

                dropdown.appendChild(renameOption);
                dropdown.appendChild(deleteOption);

                headerRow.appendChild(dropdown);
            }

            // ================= ADD TASK BUTTON =================
            const addTaskButton = document.createElement("div");
            addTaskButton.className = "add-task";
            addTaskButton.innerText = this.t("addTaskInline");

            addTaskButton.addEventListener("click", (e) => {
                e.stopPropagation();
                this._activeCreateStatus = bucket.id;

                // reset create form state
                this._newTaskTitle = "";
                this._newTaskDeadline = "";
                this._newTaskAssigneeId = "";
                this._newTaskAssigneeName = "";

                this.updateView(context);
            });

            if (!this._readOnly) {
                column.appendChild(addTaskButton);
            }

            // ================= CREATE FORM =================
            if (this._activeCreateStatus === bucket.id) {

                const formCard = document.createElement("div");
                formCard.className = "create-card";

                const content = document.createElement("div");
                content.className = "card-content";

                // prevent inside clicks from closing
                content.addEventListener("click", (e) => {
                    e.stopPropagation();
                });

                const titleInput = document.createElement("input");
                titleInput.type = "text";
                titleInput.placeholder = this.t("enterTaskName");
                titleInput.className = "create-input";
                titleInput.value = this._newTaskTitle;
                titleInput.addEventListener("input", (e) => {
                    this._newTaskTitle = (e.target as HTMLInputElement).value;
                });

                // Due date label
                const dateLabel = document.createElement("div");
                dateLabel.className = "create-meta-label";
                dateLabel.innerText = this.t("setDueDate");

                // Date input
                const dateInput = document.createElement("input");
                dateInput.type = "date";
                dateInput.className = "create-date-row";
                dateInput.value = this._newTaskDeadline;

                dateInput.addEventListener("input", (e) => {
                    this._newTaskDeadline = (e.target as HTMLInputElement).value;
                });



                const assigneeSelect = document.createElement("select");
                assigneeSelect.className = "create-input";

                const defaultOption = document.createElement("option");
                defaultOption.value = "";
                defaultOption.text = this.t("assign");
                assigneeSelect.appendChild(defaultOption);

                this._users.forEach(user => {
                    const option = document.createElement("option");
                    option.value = user.id;
                    option.text = user.name;
                    assigneeSelect.appendChild(option);
                });

                assigneeSelect.value = this._newTaskAssigneeId || "";

                assigneeSelect.addEventListener("change", (e) => {
                    const selectedId = (e.target as HTMLSelectElement).value;
                    this._newTaskAssigneeId = selectedId;

                    const selectedUser = this._users.find(u => u.id === selectedId);
                    this._newTaskAssigneeName = selectedUser?.name || "Unassigned";
                });

                const saveButton = document.createElement("button");
                saveButton.innerText = this.t("addTaskButton");
                saveButton.className = "create-button";

                // --- SAVE BUTTON ---
                saveButton.addEventListener("click", () => {
                    const title = (this._newTaskTitle || "").trim();
                    if (!title) return; // keep your required title behavior

                    const newTask = {
                        id: crypto.randomUUID(),
                        dvId: "", // IMPORTANT: blank so Power Apps treats it as CREATE
                        title: title,
                        status: bucket.id,

                        // lookup support
                        assignee: this._newTaskAssigneeName || this.t("unassigned"),
                        assigneeId: this._newTaskAssigneeId || "",

                        progress: "0/0",
                        deadline: this._newTaskDeadline || ""
                    };

                    this._tasks.push(newTask);

                    // reset create form state
                    this._activeCreateStatus = null;
                    this._newTaskTitle = "";
                    this._newTaskDeadline = "";
                    this._newTaskAssigneeId = "";
                    this._newTaskAssigneeName = "";

                    // outputs
                    this._notifyOutputChanged();
                    this.updateViewSafe();
                });

                // --- APPEND CONTROLS ---
                content.appendChild(titleInput);
                content.appendChild(dateLabel);
                content.appendChild(dateInput);
                content.appendChild(assigneeSelect); // <-- dropdown, NOT assigneeInput
                content.appendChild(saveButton);

                formCard.appendChild(content);
                column.appendChild(formCard);
            }

            // ================= TASKS =================
            const columnTasks = this._tasks
                .filter(t => (t.status || "").toLowerCase() === bucket.id.toLowerCase())
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

            columnTasks.forEach(task => {

                const card = document.createElement("div");
                card.className = "card";


                if (this._dropTargetId === task.id) {
                    card.classList.add(this._dropPlaceAfter ? "drop-after" : "drop-before");
                }
                card.addEventListener("click", () => {
                    this._taskModalTaskId = task.id;

                    // create a draft copy (so Cancel can discard)
                    this._taskDraft = {
                        ...task,
                        startDate: task.startDate || "",
                        deadline: task.completionDate || "",
                        priority: task.priority || "",
                        progressState: task.progressState || "not started",
                        description: task.description || ""
                    };

                    this.updateViewSafe();
                });

                if (this._flashTaskId === task.id) {
                    card.classList.add("copy-flash");
                }
                card.draggable = true;

                card.addEventListener("dragstart", (e) => {
                    this._draggedTaskId = task.id;

                    // optional but helps some browsers
                    try {
                        e.dataTransfer?.setData("text/plain", task.id);
                        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                    } catch (err) {
                        console.warn("Drag error", err);
                    }
                });

                card.addEventListener("dragend", () => {
                    this._draggedTaskId = null;
                });

                card.addEventListener("dragover", (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const rect = card.getBoundingClientRect();
                    const dropY = e.clientY - rect.top;
                    const after = dropY > rect.height / 2;

                    card.classList.toggle("drop-before", !after);
                    card.classList.toggle("drop-after", after);
                });

                card.addEventListener("dragleave", () => {
                    card.classList.remove("drop-before");
                    card.classList.remove("drop-after");
                });




                card.addEventListener("drop", (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    if (!this._draggedTaskId) return;

                    // decide before/after based on cursor position
                    const rect = card.getBoundingClientRect();
                    const dropY = e.clientY - rect.top;
                    const placeAfter = dropY > rect.height / 2;

                    this.moveTaskRelative(this._draggedTaskId, task.id, placeAfter, bucket.id);

                    this._draggedTaskId = null;
                    this._dropTargetId = null;
                    this.updateViewSafe();
                });

                const header = document.createElement("div");
                header.className = "task-header";

                const title = document.createElement("div");
                title.className = "card-title";
                title.innerText = task.title;

                const menuButton = document.createElement("div");
                menuButton.className = "task-menu-button";
                menuButton.innerText = "⋯";

                menuButton.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this._activeTaskMenu =
                        this._activeTaskMenu === task.id ? null : task.id;
                    this.updateViewSafe();
                });

                header.appendChild(title);

                if (!this._readOnly) {
                    header.appendChild(menuButton);
                }

                const content = document.createElement("div");
                content.className = "card-content";

                const meta = document.createElement("div");
                meta.className = "card-meta";

                const bucketId = (bucket.id || "").toLowerCase();

                if (bucketId === "todo") {
                    meta.innerText = `Estimate: ${task.estimate || ""}`;
                }
                else if (bucketId === "inprogress") {
                    meta.innerText = `Start Date: ${task.startDate || ""}`;
                }
                else if (bucketId === "done") {
                    meta.innerText = `Finish Date: ${task.completionDate || ""}`;
                }
                else if (bucketId === "reviewed") {
                    meta.innerText = `Reviewed by: ${task.reviewedBy || ""}`;
                }

                content.appendChild(meta);



                card.appendChild(header);
                card.appendChild(content);



                // ===== DROPDOWN =====
                if (this._activeTaskMenu === task.id) {

                    const dropdown = document.createElement("div");
                    dropdown.className = "task-dropdown";
                    dropdown.addEventListener("click", (e) => e.stopPropagation());

                    const assign = document.createElement("div");
                    assign.innerText = this.t("assign");
                    assign.className = "task-dropdown-item";

                    assign.addEventListener("click", (e) => {
                        e.stopPropagation();

                        // open Task details modal
                        this._taskModalTaskId = task.id;
                        this._taskDraft = {
                            ...task,
                            startDate: task.startDate || "",
                            deadline: task.completionDate || "",
                            priority: task.priority || "",
                            progressState: task.progressState || "not started",
                            description: task.description || ""
                        };

                        // open inline assign dropdown inside the modal
                        this._assignModalTaskId = task.id;
                        this._assignSearchText = "";

                        // close menus
                        this._activeMoveSubmenu = null;
                        this._activeTaskMenu = null;

                        this.updateViewSafe();
                    });

                    const copy = document.createElement("div");
                    copy.className = "task-dropdown-item";
                    copy.innerText = this.t("copy");

                    copy.addEventListener("click", (e) => {
                        e.stopPropagation();

                        const original = this._tasks.find(t => t.id === task.id);
                        if (!original) return;

                        const copiedTask = {
                            ...original,
                            id: crypto.randomUUID(),
                            dvId: "",                      // IMPORTANT: force CREATE on Next
                            title: `${original.title} (Copy)`,
                            progress: "0/0"                // reset progress
                            // keep: status, deadline, assignee, assigneeId
                        };

                        // Insert copy right after the original (nice UX)
                        const idx = this._tasks.findIndex(t => t.id === task.id);
                        if (idx >= 0) {
                            this._tasks.splice(idx + 1, 0, copiedTask);
                        } else {
                            this._tasks.push(copiedTask);
                        }

                        // flash highlight on the copied card
                        this._flashTaskId = copiedTask.id;

                        if (this._flashTimer !== null) {
                            window.clearTimeout(this._flashTimer);
                        }

                        this._flashTimer = window.setTimeout(() => {
                            this._flashTaskId = null;
                            this._flashTimer = null;
                            this.updateViewSafe();
                        }, 900);

                        // close menus
                        this._activeTaskMenu = null;
                        this._activeMoveSubmenu = null;

                        this._notifyOutputChanged();
                        this.updateViewSafe();
                    });

                    const move = document.createElement("div");
                    move.innerText = this.t("moveTask");
                    move.className = "task-dropdown-item";

                    move.addEventListener("click", (e) => {
                        e.stopPropagation();

                        this._activeMoveSubmenu =
                            this._activeMoveSubmenu === task.id ? null : task.id;


                        this.updateViewSafe();
                    });

                    const deleteItem = document.createElement("div");
                    deleteItem.innerText = this.t("delete");
                    deleteItem.className = "task-dropdown-item";

                    deleteItem.addEventListener("click", (e) => {
                        e.stopPropagation();



                        this._movedTaskId = task.id;
                        this._activeTaskMenu = null; // close menu
                        this._confirmDeleteTaskId = task.id;
                        this._confirmDeleteTaskTitle = task.title || "this task";

                        this.updateViewSafe();
                    });

                    dropdown.appendChild(assign);
                    dropdown.appendChild(copy);
                    dropdown.appendChild(move);
                    dropdown.appendChild(deleteItem);

                    header.appendChild(dropdown);

                    // ===== MOVE SUBMENU =====
                    if (this._activeMoveSubmenu === task.id) {

                        const subMenu = document.createElement("div");
                        subMenu.className = "task-move-submenu";

                        this._buckets.forEach(bucket => {

                            if (bucket.id === task.status) return;

                            const option = document.createElement("div");
                            option.className = "task-dropdown-item";
                            option.innerText = bucket.name;

                            option.addEventListener("click", (e) => {
                                e.stopPropagation();

                                task.status = bucket.id;

                                this._movedTaskId = task.id;
                                this._newStatus = bucket.id;

                                this._activeMoveSubmenu = null;
                                this._activeTaskMenu = null;

                                this._notifyOutputChanged();
                                this.updateViewSafe();
                            });

                            subMenu.appendChild(option);
                        });

                        dropdown.appendChild(subMenu);
                    }

                }

                column.appendChild(card);
            });

            // --- DROP TO BOTTOM ZONE (always last in column) ---
            const dropZone = document.createElement("div");
            dropZone.className = "column-drop-zone";
            dropZone.innerText = this.t("dropHereBottom");

            dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("is-over"); });

            dropZone.addEventListener("dragleave", (e) => { dropZone.classList.remove("is-over"); });

            dropZone.addEventListener("drop", (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove("is-over");

                if (!this._draggedTaskId) return;

                const t = this._tasks.find(x => x.id === this._draggedTaskId);
                if (t) {
                    const fromBucket = t.status;
                    t.status = bucket.id;

                    // force to end by order
                    const bucketTasks = this._tasks.filter(x =>
                        (x.status || "").toLowerCase() === bucket.id.toLowerCase() && x.id !== t.id
                    );
                    const maxOrder = bucketTasks.reduce((m, x) => Math.max(m, x.order ?? 0), 0);
                    t.order = maxOrder + 10;

                    this.normalizeBucketOrder(bucket.id);
                    if (fromBucket && fromBucket !== bucket.id) this.normalizeBucketOrder(fromBucket);

                    this._movedTaskId = t.id;
                    this._newStatus = bucket.id;
                    this._notifyOutputChanged();
                }

                this._draggedTaskId = null;
                this._dropTargetId = null;
                this.updateViewSafe();
            });

            column.appendChild(dropZone);

            return column;
        };

        this._buckets.forEach(bucket => {
            board.appendChild(createColumn(bucket));
        });

        this._container.appendChild(board);

        // ================= TASK EDIT MODAL =================
        if (this._taskModalTaskId && this._taskDraft) {
            const overlay = document.createElement("div");
            overlay.className = "task-overlay";
            overlay.addEventListener("click", () => {
                // close  saving draft changes back to the task (if user clicked outside modal, we treat it as "Save and close")
                this.closeTaskModal(true);
            });

            const modal = document.createElement("div");
            modal.className = "task-modal";
            modal.addEventListener("click", (e) => e.stopPropagation());

            // Close inline assign dropdown when clicking anywhere inside modal (but outside panel)
            modal.addEventListener("click", () => {
                if (this._assignModalTaskId === this._taskModalTaskId) {
                    this._assignModalTaskId = null;
                    this._assignSearchText = "";
                    this.updateViewSafe();
                }
            });

            const header = document.createElement("div");
            header.className = "task-modal-header";

            const hTitle = document.createElement("div");
            hTitle.className = "task-modal-title-input";
            hTitle.innerText = this._taskDraft.title || "";

            const closeX = document.createElement("div");
            closeX.className = "task-modal-close";
            closeX.innerText = "✕";
            closeX.addEventListener("click", () => {
                this.closeTaskModal(true);
            });

            header.appendChild(hTitle);
            header.appendChild(closeX);


            const body = document.createElement("div");
            body.className = "task-modal-body figma-task-body";



            /* ===== Row 1: Assign ===== */
            const assignRow = document.createElement("div");
            assignRow.className = "task-single-row";

            const assignBlock = document.createElement("div");
            assignBlock.className = "task-assign-block";
            assignBlock.style.position = "relative";

            const assignLabel = document.createElement("div");
            assignLabel.className = "task-field-label";
            assignLabel.innerText = this.t("assign");

            const pillsRow = document.createElement("div");
            pillsRow.className = "task-assign-pills";

            /* Single assignee pill */
            const pill = document.createElement("div");
            pill.className = "assignee-pill";

            const pillName = (this._taskDraft.assignee || "Unassigned").trim();
            const initials =
                pillName === "Unassigned"
                    ? "—"
                    : pillName
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map(x => x[0].toUpperCase())
                        .join("");

            const avatar = document.createElement("span");
            avatar.className = "assignee-avatar";
            avatar.innerText = initials;

            const pillText = document.createElement("span");
            pillText.className = "assignee-pill-text";
            pillText.innerText = pillName;

            pill.appendChild(avatar);
            pill.appendChild(pillText);
            pillsRow.appendChild(pill);

            if (this._assignModalTaskId === this._taskModalTaskId) {
                const panel = document.createElement("div");
                panel.className = "assign-panel";
                panel.addEventListener("click", (e) => e.stopPropagation());

                const search = document.createElement("input");
                search.className = "assign-panel-search";
                search.type = "text";
                search.placeholder = this.t("searchAssignee");
                search.value = this._assignSearchText;

                const list = document.createElement("div");
                list.className = "assign-panel-list";

                const renderList = () => {
                    list.innerHTML = "";
                    const query = (search.value || "").toLowerCase();

                    const un = document.createElement("div");
                    un.className = "assign-panel-item";
                    un.innerText = this.t("unassigned");
                    un.addEventListener("click", () => {
                        this._taskDraft!.assignee = this.t("unassigned");
                        this._taskDraft!.assigneeId = "";
                        this._assignModalTaskId = null;
                        this._assignSearchText = "";
                        this.updateViewSafe();
                    });
                    list.appendChild(un);

                    this._users
                        .filter(u => !query || (u.name || "").toLowerCase().includes(query))
                        .slice(0, 50)
                        .forEach(u => {
                            const item = document.createElement("div");
                            item.className = "assign-panel-item";

                            const av = document.createElement("span");
                            av.className = "assign-panel-avatar";

                            if (u.photo) {
                                const img = document.createElement("img");
                                img.className = "assign-panel-photo";
                                img.src = u.photo;
                                img.alt = u.name;
                                av.appendChild(img);
                            } else {
                                const initials = (u.name || "")
                                    .split(" ")
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map(x => x[0].toUpperCase())
                                    .join("") || "—";
                                av.innerText = initials;
                            }

                            const txt = document.createElement("span");
                            txt.className = "assign-panel-name";
                            txt.innerText = u.name;

                            item.appendChild(av);
                            item.appendChild(txt);

                            item.addEventListener("click", () => {
                                this._taskDraft!.assignee = u.name;
                                this._taskDraft!.assigneeId = u.id;
                                this._assignModalTaskId = null;
                                this._assignSearchText = "";
                                this.updateViewSafe();
                            });

                            list.appendChild(item);
                        });
                };

                search.addEventListener("input", () => {
                    this._assignSearchText = search.value;
                    renderList();
                });

                panel.appendChild(search);
                panel.appendChild(list);
                renderList();

                assignBlock.appendChild(panel);
                window.setTimeout(() => search.focus(), 0);
            }

            assignBlock.appendChild(assignLabel);
            assignBlock.appendChild(pillsRow);
            assignRow.appendChild(assignBlock);

          

            /* ===== Dates row: Start date + End date (Due date) ===== */
            const datesGrid = document.createElement("div");
            datesGrid.className = "task-grid-2";

            const startWrap = document.createElement("div");
            const startLabel = document.createElement("div");
            startLabel.className = "task-field-label";
            startLabel.innerText = this.t("startDate");

            const startValue = document.createElement("div");
            startValue.className = "task-field-input";
            startValue.innerText = this._taskDraft.startDate || "";

            startWrap.appendChild(startLabel);
            startWrap.appendChild(startValue);

            const endWrap = document.createElement("div");
            const endLabel = document.createElement("div");
            endLabel.className = "task-field-label";
            endLabel.innerText = this.t("endDate");

            const endValue = document.createElement("div");
            endValue.className = "task-field-input";
            endValue.innerText = this._taskDraft.deadline || "";

            endWrap.appendChild(endLabel);
            endWrap.appendChild(endValue);

            datesGrid.appendChild(startWrap);
            datesGrid.appendChild(endWrap);

            /* ===== Notes (Description) ===== */
            

            const notes = document.createElement("div");
            notes.className = "task-notes-richtext";
            notes.innerHTML = this.sanitizeHtml(this._taskDraft.description || "");

            /* Assemble body */
            body.appendChild(assignRow);
            body.appendChild(datesGrid);
            body.appendChild(notes);

            /* ===== Render modal ===== */
            modal.appendChild(header);
            modal.appendChild(body);

            overlay.appendChild(modal);
            this._container.appendChild(overlay);
        }

        // ========= ADD NEW BUCKET COLUMN =========
        const addBucketColumn = document.createElement("div");
        addBucketColumn.className = "add-bucket-column";
        addBucketColumn.innerText = this.t("addBucket");
        addBucketColumn.addEventListener("click", () => {
            const nextOrder = this._buckets.length === 0
                ? 0
                : Math.max(...this._buckets.map(b => b.order ?? 0)) + 1;

            const newBucket = {
                id: crypto.randomUUID(),
                name: "New bucket",
                order: nextOrder
            };

            this._buckets.push(newBucket);

            // optionally open rename immediately (Planner-ish)
            this._renamingBucket = newBucket.id;

            this._notifyOutputChanged();
            this.updateViewSafe();
        });

        if (!this._readOnly) {
            board.appendChild(addBucketColumn);
        }




        if (this._confirmDeleteTaskId) {
            this.renderDeleteConfirmModal(context);
        }
    }

    public getOutputs(): IOutputs {

        const outputs = {
            movedTaskId: this._movedTaskId || "",
            newStatus: this._newStatus || "",
            addTaskRequested: this._addTaskRequested || "",
            addTaskStatus: this._addTaskStatus || "",
            updatedTasksJson: JSON.stringify(this._tasks),
            updatedBucketsJson: JSON.stringify(this._buckets)
        };

        this._movedTaskId = null;
        this._newStatus = null;
        this._addTaskRequested = null;
        this._addTaskStatus = null;

        return outputs;
    }

    public destroy(): void {
        document.removeEventListener("click", this.handleDocumentClick);
    }
}