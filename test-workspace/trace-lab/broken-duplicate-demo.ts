type Task = {
  id: string;
  title: string;
};

type Task = {
  id: number;
  done: boolean;
};

export const currentTask: Task = {
  id: "task-1",
  title: "debug duplicate declarations",
};

export const currentTask = {
  id: "task-2",
  done: false,
};
