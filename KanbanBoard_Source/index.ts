import { IInputs, IOutputs } from "./generated/ManifestTypes";

interface Task {
  id: string;
  dvId?: string;

  title: string;
  status: string;

  assignee: string;
  assigneeId?: string;

  reviewedBy?: string;
  reviewedDate?: string;
  estimate?: string;
  completionDate?: string;

  deadline: string; // due date (yyyy-mm-dd)
  startDate?: string; // yyyy-mm-dd

  priority?: string; // e.g. "low" | "medium" | "high"
  progressState?: string; // "not started" | "in progress" | "completed"

  description?: string;

  // keep this because you already have it in your JSON
  progress: string;
  topic?: string;
  comment?: string;
  displayOrder?: number;
  isOverdue?: boolean;
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
      status: "Status",
      bucket: "Bucket",
      startDate: "Start date",
      endDate: "End date",
      notes: "Notes",
      notesPlaceholder: "Type a description or add notes here",
      deleteTaskTitle: "Delete task?",
      deleteTaskMessage:
        'Are you sure you want to delete "{0}"? The deletion will be applied after you click Next.',
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
      deleteBucketBlocked:
        "This bucket contains tasks. Move or delete them first.",
      topic: "Topic",
      estimate: "Estimate",
      finishDate: "Finish Date",
      reviewedBy: "Reviewed by",
      reviewedDate: "Reviewed Date",
      daysLeft: "{0}d left",
      daysOverdue: "{0}d overdue",
      daysLate: "{0}d late",
      onTime: "On time",
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
      status: "Status",
      bucket: "Bucket",
      startDate: "Data rozpoczęcia",
      endDate: "Data zakończenia",
      notes: "Notatki",
      notesPlaceholder: "Wpisz opis lub dodaj notatki tutaj",
      deleteTaskTitle: "Usunąć zadanie?",
      deleteTaskMessage:
        'Czy na pewno chcesz usunąć "{0}"? Usunięcie zostanie zastosowane po kliknięciu Dalej.',
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
      deleteBucketBlocked:
        "Ten bucket zawiera zadania. Najpierw je przenieś lub usuń.",
      topic: "Temat",
      estimate: "Szacowany czas",
      finishDate: "Data ukończenia",
      reviewedBy: "Sprawdzone przez",
      reviewedDate: "Data sprawdzenia",
      daysLeft: "pozostało {0} dni",
      daysOverdue: "{0} dni po terminie",
      daysLate: "{0} dni opóźnienia",
      onTime: "W terminie",
    },
  };

  private t(key: keyof typeof this._labels.EN): string {
    return this._labels[this._languageCode][key] || this._labels.EN[key];
  }

  private sanitizeHtml(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = html;

    const allowedTags = new Set([
      "P",
      "BR",
      "STRONG",
      "B",
      "EM",
      "I",
      "U",
      "S",
      "UL",
      "OL",
      "LI",
      "H1",
      "H2",
      "H3",
      "H4",
      "BLOCKQUOTE",
      "A",
    ]);

    const walker = document.createTreeWalker(
      template.content,
      NodeFilter.SHOW_ELEMENT,
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
        if (!href.startsWith("https://") && !href.startsWith("http://")) {
          element.removeAttribute("href");
        } else {
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer");
        }
      }
    });

    return template.innerHTML;
  }

  // Local date as yyyy-mm-dd (toISOString would give the UTC date).
  private todayLocal(): string {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${mm}-${dd}`;
  }

  // Calendar days between two yyyy-mm-dd dates, like DateDiff(..., TimeUnit.Days).
  private daysBetween(from: string, to: string): number | null {
    const toUtc = (value: string): number | null => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      if (!match) return null;
      return Date.UTC(+match[1], +match[2] - 1, +match[3]);
    };

    const start = toUtc(from);
    const end = toUtc(to);
    if (start === null || end === null) return null;

    return Math.round((end - start) / 86400000);
  }

  // Days late for a finished task: (completion - start) - estimate, never below 0.
  private getDelayDays(task: Task): number | null {
    const estimate = Number(task.estimate);
    if (!task.startDate || !task.completionDate || task.estimate === "" || isNaN(estimate)) {
      return null;
    }

    const spent = this.daysBetween(task.startDate, task.completionDate);
    if (spent === null) return null;

    return Math.max(0, spent - estimate);
  }

  // Timing suffix shown in brackets after the date, e.g. "⏳ (3d left)".
  private getTimingInfo(task: Task, bucketId: string): { text: string; overdue: boolean } {
    if (bucketId === "inprogress") {
      const estimate = Number(task.estimate);
      if (!task.startDate || task.estimate === "" || isNaN(estimate)) {
        return { text: "", overdue: false };
      }

      const elapsed = this.daysBetween(task.startDate, this.todayLocal());
      if (elapsed === null) return { text: "", overdue: false };

      const left = estimate - elapsed;
      return left < 0
        ? { text: `🔥 (${this.t("daysOverdue").replace("{0}", String(-left))})`, overdue: true }
        : { text: `⏳ (${this.t("daysLeft").replace("{0}", String(left))})`, overdue: false };
    }

    if (bucketId === "done" || bucketId === "reviewed") {
      const delay = this.getDelayDays(task);
      if (delay === null) return { text: "", overdue: false };

      return delay > 0
        ? { text: `⚠️ (${this.t("daysLate").replace("{0}", String(delay))})`, overdue: true }
        : { text: `✅ (${this.t("onTime")})`, overdue: false };
    }

    return { text: "", overdue: false };
  }

  // Updates status and dates when a task moves to another bucket.
  // Shared by all drop handlers so they stay in sync.
  private applyStatusTransition(task: Task, targetBucketId: string): void {
    const newBucketId = targetBucketId.toLowerCase();
    task.status = targetBucketId;

    const today = this.todayLocal();

    if (newBucketId === "inprogress" && !task.startDate) {
      task.startDate = today;
    }

    if (newBucketId === "done" && !task.completionDate) {
      task.completionDate = today;
    } else if (newBucketId === "inprogress" || newBucketId === "todo") {
      task.completionDate = "";
    }

    if (newBucketId === "reviewed") {
      if (!task.reviewedDate) task.reviewedDate = today;
    } else {
      task.reviewedBy = "";
      task.reviewedDate = "";
    }

    task.isOverdue = this.getTimingInfo(task, newBucketId).overdue;
  }

  // Order of cards inside a bucket: working buckets show the most recent tasks
  // first, everything else follows the internship order (displayOrder).
  private compareTasksInBucket(bucketId: string): (a: Task, b: Task) => number {
    const byDisplayOrder = (a: Task, b: Task): number => {
      const x = Number(a.displayOrder);
      const y = Number(b.displayOrder);
      const xMissing = a.displayOrder == null || isNaN(x);
      const yMissing = b.displayOrder == null || isNaN(y);
      if (xMissing || yMissing) return Number(xMissing) - Number(yMissing);
      return x - y;
    };

    const dateOf: ((t: Task) => string | undefined) | null =
      bucketId === "inprogress"
        ? (t) => t.startDate
        : bucketId === "done"
          ? (t) => t.completionDate
          : bucketId === "reviewed"
            ? (t) => t.reviewedDate || t.completionDate
            : null;

    if (!dateOf) return byDisplayOrder;

    return (a, b) => {
      const x = dateOf(a) || "";
      const y = dateOf(b) || "";
      // yyyy-mm-dd compares correctly as a string; tasks without a date go last
      if (x !== y) {
        if (!x) return 1;
        if (!y) return -1;
        return y.localeCompare(x);
      }
      return byDisplayOrder(a, b);
    };
  }

  private _container!: HTMLDivElement;
  private _notifyOutputChanged!: () => void;
  private _readOnly = false;

  private _tasks: Task[] = [];

  private _actionTrigger = "";

  private _draggedTaskId: string | null = null;
  private _updatedTaskId: string | null = null;
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
    container: HTMLDivElement,
  ): void {
    this._container = document.createElement("div");
    container.appendChild(this._container);
    this._notifyOutputChanged = notifyOutputChanged;
    document.addEventListener("click", this.handleDocumentClick);
  }

  private closeTaskModal(save: boolean): void {
    if (!this._readOnly && save && this._taskModalTaskId && this._taskDraft) {
      const id = this._taskModalTaskId;
      const idx = this._tasks.findIndex((t) => t.id === id);

      if (idx >= 0) {
        const originalTask = this._tasks[idx];

        const oldComment = originalTask.comment || "";
        const newComment = this._taskDraft.comment || "";
        const isModified = oldComment !== newComment;

        if (isModified) {
          // commit draft -> real task
          this._tasks[idx] = {
            ...this._tasks[idx],
            ...this._taskDraft,
          } as Task;

          const afterStatus = this._tasks[idx].status;

          // outputs for Power Apps
          this._updatedTaskId = id;
          this._newStatus = afterStatus;
          this._actionTrigger = Date.now().toString();
          this._notifyOutputChanged();
        }
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

    if (!target.closest(".bucket-header") && !target.closest(".task-header")) {
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
    msg.innerText = msgTemplate.replace(
      "{0}",
      this._confirmDeleteTaskTitle || "",
    );

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
      this._tasks = this._tasks.filter((t) => t.id !== id);

      // notify Power Apps (so Next button saves deletes)
      this._updatedTaskId = id;
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

  public updateView(context: KanbanContext): void {
    this._latestContext = context;

    const rawLanguage = (
      context.parameters.languageCode.raw || "EN"
    ).toUpperCase();
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

    if (this._openTaskId && this._openTaskId !== this._lastOpenedTaskId) {
      const taskToOpen = this._tasks.find(
        (t) => String(t.dvId || t.id) === this._openTaskId,
      );

      if (taskToOpen) {
        this._taskModalTaskId = taskToOpen.id;
        this._taskDraft = {
          ...taskToOpen,
          startDate: taskToOpen.startDate || "",
          deadline: taskToOpen.deadline || "",
          priority: taskToOpen.priority || "",
          progressState: taskToOpen.progressState || "not started",
          description: taskToOpen.description || "",
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
          .filter((b) => !!b && !!b.id && !!b.name)
          .map((b, idx) => ({
            id: String(b.id),
            name: String(b.name),
            order: typeof b.order === "number" ? b.order : idx,
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
      // Cards don't handle drops themselves: a drop anywhere in the column
      // lands here, and the card position comes from compareTasksInBucket.
      column.addEventListener("dragover", (e) => {
        e.preventDefault();
        column.classList.add("drag-over");
      });

      column.addEventListener("dragleave", (e) => {
        if (!column.contains(e.relatedTarget as Node | null)) {
          column.classList.remove("drag-over");
        }
      });

      column.addEventListener("drop", (e) => {
        e.preventDefault();
        column.classList.remove("drag-over");

        if (!this._draggedTaskId) return;

        const task = this._tasks.find((t) => t.id === this._draggedTaskId);
        if (task) {
          const fromBucket = (task.status || "todo").toLowerCase();
          const newBucketId = bucket.id.toLowerCase();
          const allowedTransitions: Record<string, string[]> = {
            todo: ["inprogress"],
            inprogress: ["todo", "done"],
            done: ["inprogress", "reviewed"],
            reviewed: ["done", "inprogress"],
          };
          if (!allowedTransitions[fromBucket]?.includes(newBucketId)) {
            this._draggedTaskId = null;
            this.updateViewSafe();
            return;
          }
          this.applyStatusTransition(task, bucket.id);

          this._updatedTaskId = task.id;
          this._newStatus = bucket.id;
          this._actionTrigger = Date.now().toString();
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
          const index = this._buckets.findIndex((b) => b.id === bucket.id);
          if (index > -1) {
            this._buckets[index].name = renameInput.value;
          }
          this._renamingBucket = null;

          this._notifyOutputChanged(); // ✅ THIS is the missing piece
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

      /*if (!this._readOnly) {
        headerRow.appendChild(menuButton);
      }*/
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
          const hasTasks = this._tasks.some((t) => t.status === bucket.id);

          if (hasTasks) {
            alert("This bucket contains tasks. Move or delete them first.");
            this._activeBucketMenu = null;
            this.updateView(context);
            return;
          }

          this._buckets = this._buckets.filter((b) => b.id !== bucket.id);

          this._activeBucketMenu = null;

          this._notifyOutputChanged(); // 🔴 REQUIRED
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

      /*
      if (!this._readOnly) {
        column.appendChild(addTaskButton);
      }
      */

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

        this._users.forEach((user) => {
          const option = document.createElement("option");
          option.value = user.id;
          option.text = user.name;
          assigneeSelect.appendChild(option);
        });

        assigneeSelect.value = this._newTaskAssigneeId || "";

        assigneeSelect.addEventListener("change", (e) => {
          const selectedId = (e.target as HTMLSelectElement).value;
          this._newTaskAssigneeId = selectedId;

          const selectedUser = this._users.find((u) => u.id === selectedId);
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
            deadline: this._newTaskDeadline || "",
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
        .filter(
          (t) => (t.status || "").toLowerCase() === bucket.id.toLowerCase(),
        )
        .sort(this.compareTasksInBucket(bucket.id.toLowerCase()));

      columnTasks.forEach((task) => {
        const card = document.createElement("div");
        card.className = "card";

        card.addEventListener("click", () => {
          this._taskModalTaskId = task.id;

          // create a draft copy (so Cancel can discard)
          this._taskDraft = {
            ...task,
            startDate: task.startDate || "",
            deadline: task.completionDate || "",
            priority: task.priority || "",
            progressState: task.progressState || "not started",
            description: task.description || "",
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

        const header = document.createElement("div");
        header.className = "task-header";

        if (task.displayOrder !== undefined) {
          const orderBadge = document.createElement("div");
          orderBadge.className = "card-order-badge";
          orderBadge.innerText = `#${task.displayOrder}`;
          header.appendChild(orderBadge);
        }

        if (task.topic !== undefined) {
          const topic = document.createElement("div");
          topic.className = "card-topic";
          topic.innerText = `${task.topic}`;
          header.appendChild(topic);
        }

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
        /*
        if (!this._readOnly) {
          header.appendChild(menuButton);
        }*/

        const content = document.createElement("div");
        content.className = "card-content";

        const meta = document.createElement("div");
        meta.className = "card-meta";

        const bucketId = (bucket.id || "").toLowerCase();

        const timing = this.getTimingInfo(task, bucketId).text;
        const withTiming = (date?: string): string =>
          date && timing ? `${date} ${timing}` : date || "";

        if (bucketId === "todo") {
          meta.innerText = `${this.t("estimate")}: ${task.estimate || ""}d`;
        } else if (bucketId === "inprogress") {
          meta.innerText = `${this.t("startDate")}: ${withTiming(task.startDate)}`;
        } else if (bucketId === "done") {
          meta.innerText = `${this.t("finishDate")}: ${withTiming(task.completionDate)}`;
        } else if (bucketId === "reviewed") {
          meta.innerText = `${this.t("reviewedBy")}: ${task.reviewedBy || ""}\n${this.t("reviewedDate")}: ${withTiming(task.reviewedDate)}`;
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
              description: task.description || "",
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

            const original = this._tasks.find((t) => t.id === task.id);
            if (!original) return;

            const copiedTask = {
              ...original,
              id: crypto.randomUUID(),
              dvId: "", // IMPORTANT: force CREATE on Next
              title: `${original.title} (Copy)`,
              progress: "0/0", // reset progress
              // keep: status, deadline, assignee, assigneeId
            };

            // Insert copy right after the original (nice UX)
            const idx = this._tasks.findIndex((t) => t.id === task.id);
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

            this._updatedTaskId = task.id;
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

            this._buckets.forEach((bucket) => {
              if (bucket.id === task.status) return;

              const option = document.createElement("div");
              option.className = "task-dropdown-item";
              option.innerText = bucket.name;

              option.addEventListener("click", (e) => {
                e.stopPropagation();

                task.status = bucket.id;

                this._updatedTaskId = task.id;
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

      return column;
    };

    this._buckets.forEach((bucket) => {
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
      body.style.textAlign = "left";

      /* ===== Row 1: Topic ===== */
      const topicRow = document.createElement("div");
      topicRow.className = "task-single-row";

      const topicLabel = document.createElement("div");
      topicLabel.className = "task-field-label";
      topicLabel.innerText = this.t("topic");

      const topicValue = document.createElement("div");
      topicValue.className = "task-field-input";
      topicValue.innerText = this._taskDraft.topic || "—";

      topicRow.appendChild(topicLabel);
      topicRow.appendChild(topicValue);

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

      /* ===== Comment ===== */

      const commentWrap = document.createElement("div");
      commentWrap.className = "task-single-row";
      commentWrap.style.marginTop = "16px";

      const commentLabel = document.createElement("div");
      commentLabel.className = "task-field-label";
      commentLabel.innerText = "Comment"; // или this.t("comment") если добавили в переводы

      const commentInput = document.createElement("textarea");
      commentInput.className = "task-field-input task-comment-input";
      commentInput.maxLength = 2000;

      commentInput.value = this._taskDraft.comment || "";

      commentInput.addEventListener("input", (e) => {
        this._taskDraft!.comment = (e.target as HTMLTextAreaElement).value;
      });

      commentWrap.appendChild(commentLabel);
      commentWrap.appendChild(commentInput);

      /* ===== Notes (Description) ===== */

      const notes = document.createElement("div");
      notes.className = "task-notes-richtext";
      notes.innerHTML = this.sanitizeHtml(this._taskDraft.description || "");

      /* Assemble body */
      body.appendChild(topicRow);
      body.appendChild(datesGrid);
      body.appendChild(commentWrap);
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
      const nextOrder =
        this._buckets.length === 0
          ? 0
          : Math.max(...this._buckets.map((b) => b.order ?? 0)) + 1;

      const newBucket = {
        id: crypto.randomUUID(),
        name: "New bucket",
        order: nextOrder,
      };

      this._buckets.push(newBucket);

      // optionally open rename immediately (Planner-ish)
      this._renamingBucket = newBucket.id;

      this._notifyOutputChanged();
      this.updateViewSafe();
    });
    /*
    if (!this._readOnly) {
      board.appendChild(addBucketColumn);
    }
    */

    if (this._confirmDeleteTaskId) {
      this.renderDeleteConfirmModal(context);
    }
  }

  public getOutputs(): IOutputs {
    const outputs = {
      updatedTaskId: this._updatedTaskId || "",
      newStatus: this._newStatus || "",
      addTaskRequested: this._addTaskRequested || "",
      addTaskStatus: this._addTaskStatus || "",
      updatedTasksJson: JSON.stringify(this._tasks),
      updatedBucketsJson: JSON.stringify(this._buckets),
      actionTrigger: this._actionTrigger,
    };

    console.log("🔥 getOutputs sends data:", outputs);

    //this._updatedTaskId = null;
    //this._newStatus = null;
    //this._addTaskRequested = null;
    //this._addTaskStatus = null;

    return outputs;
  }

  public destroy(): void {
    document.removeEventListener("click", this.handleDocumentClick);
  }
}
