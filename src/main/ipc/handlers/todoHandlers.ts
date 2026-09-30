import { CHANNELS } from '../../../shared/ipc/channels.ts'
import type { TodoService } from '../../agenda/TodoService.ts'
import type { QuickAddWindow } from '../../windows/QuickAddWindow.ts'
import type { IpcRouter } from '../IpcRouter.ts'

export interface TodoHandlerDeps {
  readonly todos: TodoService
  readonly quickAdd: QuickAddWindow
}

/**
 * Nothing is returned: every mutation emits a snapshot, which main pushes to
 * whichever windows are open, so the two renderers can never disagree (§5).
 */
export function registerTodoHandlers(router: IpcRouter, deps: TodoHandlerDeps): void {
  // The quick-add window stays open or closes itself afterwards, so adding
  // never hides it from here.
  router.handle(CHANNELS.todosAdd, ({ title }) => {
    deps.todos.add(title)
  })

  router.handle(CHANNELS.todosToggle, ({ todoId }) => {
    deps.todos.toggle(todoId)
  })

  router.handle(CHANNELS.todosRoll, ({ todoId }) => {
    deps.todos.roll(todoId)
  })

  router.handle(CHANNELS.todosRollAllOverdue, () => {
    deps.todos.rollAllOverdue()
  })

  router.handle(CHANNELS.todosRemove, ({ todoId }) => {
    deps.todos.remove(todoId)
  })

  router.handle(CHANNELS.quickAddClose, () => {
    deps.quickAdd.hide()
  })
}
