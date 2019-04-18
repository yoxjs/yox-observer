/**
 * 触发异步变化时，用此函数过滤下，哪些 listener 应该执行
 *
 * @param item
 * @param args
 */
export default function (item: Record<string, any>, args?: Record<string, any> | any[]): boolean | void {

  if (item.dirty > 0 && args) {

    // 采用计数器的原因是，同一个 item 可能执行多次
    // 比如监听 user.*，如果同批次修改了 user.name 和 user.age
    // 这个监听器会调用多次，如果第一次执行就把 dirty 干掉了，第二次就无法执行了

    item.dirty--

    // 新旧值不相等
    return args[0] !== args[1]

  }

}