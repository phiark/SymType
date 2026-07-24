import type { ApiError } from "./api";

export type UserErrorContext =
  "load" | "save" | "start" | "backup" | "restore" | "session" | "game";

export interface UserErrorPresentation {
  title: string;
  message: string;
  diagnosticCode?: string;
}

const contextFallbacks: Readonly<Record<UserErrorContext, UserErrorPresentation>> = {
  load: {
    title: "暂时无法读取数据",
    message: "已保存的数据仍保留在这台电脑。请重试；如果问题持续，请重启 SymType。"
  },
  save: {
    title: "本次更改尚未保存",
    message: "已保存的数据未受影响。请保留当前页面并重试。"
  },
  start: {
    title: "暂时无法开始",
    message: "当前任务没有进入练习界面，已有数据未受影响。请重试。"
  },
  backup: {
    title: "暂时无法创建或读取备份",
    message: "现有数据未改变。请重试；如果问题持续，请重启 SymType。"
  },
  restore: {
    title: "恢复没有完成",
    message: "当前数据未被替换。请检查备份文件后重试。"
  },
  session: {
    title: "当前操作没有完成",
    message: "已经保存的训练记录未受影响。请重试或安全退出当前页面。"
  },
  game: {
    title: "找不到要打开的游戏任务",
    message: "已有游戏结果未受影响。请返回游戏页并重新选择或开始任务。"
  }
};

function withCode(presentation: UserErrorPresentation, error: ApiError): UserErrorPresentation {
  return { ...presentation, diagnosticCode: error.code };
}

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|load failed|network ?error|network request failed/iu.test(error.message);
}

function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof Error &&
    typeof (error as Partial<ApiError>).code === "string" &&
    typeof (error as Partial<ApiError>).status === "number"
  );
}

function structuredPresentation(error: ApiError): UserErrorPresentation | undefined {
  if (error.code === "CSRF_FAILED") {
    return {
      title: "页面凭据已失效",
      message: "本次操作没有保存，已有数据未改变。请刷新页面后重试。"
    };
  }
  if (error.code === "STATE_CONFLICT") {
    return {
      title: "页面中的状态已经变化",
      message: "本次操作没有保存，已有数据未改变。请刷新页面后重试。"
    };
  }
  if (error.code === "INVALID_BACKUP" || error.code === "INVALID_SQLITE_BODY") {
    return {
      title: "所选备份无法通过安全检查",
      message: "当前数据未被替换。请选择其他备份，或重新导出后再试。"
    };
  }
  if (
    error.code === "INVALID_HOST" ||
    error.code === "INVALID_ORIGIN" ||
    error.code === "CLIENT_CONTRACT_MISMATCH" ||
    error.code === "SERVER_CONTRACT_MISMATCH"
  ) {
    return {
      title: "SymType 已停止这次请求",
      message: "数据未改变。请从本机启动页重新打开 SymType；如果问题持续，请重启应用。"
    };
  }
  if (error.code === "PRESET_READ_ONLY") {
    return {
      title: "内置键盘方案不能直接修改",
      message: "已有设置未改变。请先复制这份方案，再编辑副本。"
    };
  }
  if (error.code === "INCOMPLETE_MAPPING" || error.code === "INVALID_MAPPING") {
    return {
      title: "键盘方案尚不完整",
      message: "已有设置未改变。请检查每个按键的建议手指后再保存。"
    };
  }
  if (error.code === "LAYOUT_NOT_FOUND") {
    return {
      title: "找不到这份键盘方案",
      message: "已有设置未改变。请刷新设置页并重新选择。"
    };
  }
  if (error.code === "TEXT_COMPLETE" || error.code === "LONG_FORM_COMPLETE") {
    return {
      title: "这份内容已经练习完毕",
      message: "已有训练记录仍保留。请返回训练页并选择其他内容。"
    };
  }
  if (error.code === "TEXT_NOT_FOUND") {
    return {
      title: "找不到这份练习内容",
      message: "已有训练记录仍保留。请返回训练页并重新选择内容。"
    };
  }
  if (error.code === "UNSUPPORTED_CUSTOM_TEXT_CHARACTER") {
    return {
      title: "文本中有当前键盘无法输入的字符",
      message: "原文没有被改写。请整理文本后重新导入。"
    };
  }
  if (
    error.code === "INVALID_SCOPE" ||
    error.code === "INVALID_SCOPE_CHARACTER" ||
    error.code === "SCOPE_CHARACTER_MISMATCH" ||
    error.code === "EMPTY_SCOPE" ||
    error.code === "UNSUPPORTED_CONTENT_MODE"
  ) {
    return {
      title: "当前训练范围无法使用",
      message: "已有训练记录未受影响。请返回训练页并调整训练目标。"
    };
  }
  if (
    error.code === "SESSION_NOT_FOUND" ||
    error.code === "LESSON_NOT_FOUND" ||
    error.code === "POSITION_BLOCK_MISMATCH" ||
    error.code === "PROGRESS_GAP" ||
    error.code === "BLOCK_CONTEXT_MISMATCH"
  ) {
    return {
      title: "当前训练状态已经变化",
      message: "已经保存的记录仍保留。请安全退出并重新打开训练。"
    };
  }
  if (
    error.code === "RUN_NOT_FOUND" ||
    error.code === "GAME_LEVEL_MISMATCH" ||
    error.code === "GAME_RESULT_REJECTED"
  ) {
    return {
      title: "当前游戏任务已经变化",
      message: "已经保存的结果仍保留。请返回游戏页并重新打开任务。"
    };
  }
  if (
    error.code === "GAME_CONTENT_MISSING" ||
    error.code === "GAME_STAGE_REQUIRED" ||
    error.code === "INVALID_GAME_CONTEXT"
  ) {
    return {
      title: "当前关卡无法继续",
      message: "已经保存的结果仍保留。请返回游戏页；如果问题持续，请重启 SymType。"
    };
  }
  if (error.code === "TEST_NO_EVIDENCE") {
    return {
      title: "这次测试没有可统计的输入",
      message: "它不会进入排行榜或个人最佳。请返回测试页重新开始。"
    };
  }
  if (error.code === "VALIDATION_ERROR" || error.code === "UNSUPPORTED_MEDIA_TYPE") {
    return {
      title: "提交的内容无法处理",
      message: "已有数据未改变。请检查当前选项或所选文件后重试。"
    };
  }
  if (error.code === "NOT_FOUND" || error.code === "ROUTE_NOT_FOUND") {
    return {
      title: "找不到所需内容",
      message: "已有数据未改变。请返回上一页并重试。"
    };
  }
  if (error.code === "WEB_NOT_BUILT") {
    return {
      title: "SymType 的页面文件不完整",
      message: "已有数据仍保留在本机。请重新启动或更新 SymType。"
    };
  }
  return undefined;
}

export function presentUserError(
  error: unknown,
  context: UserErrorContext = "load"
): UserErrorPresentation {
  if (isConnectionFailure(error)) {
    return {
      title: "SymType 暂时没有回应",
      message: "已保存的数据仍保留在这台电脑。请确认 SymType 正在运行，然后重试。"
    };
  }

  if (isApiError(error)) {
    return withCode(structuredPresentation(error) ?? contextFallbacks[context], error);
  }

  return contextFallbacks[context];
}

export function userErrorText(error: unknown, context: UserErrorContext = "load"): string {
  const presentation = presentUserError(error, context);
  return `${presentation.title}。${presentation.message}`;
}
