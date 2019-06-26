import {
  ComputedGetter,
  ComputedSetter,
  ComputedInterface,
  ObserverInterface,
} from '../../yox-type/src/type'

import {
  Watcher,
  WatcherOptions,
} from '../../yox-type/src/global'

import execute from '../../yox-common/src/function/execute'

import * as env from '../../yox-common/src/util/env'
import * as array from '../../yox-common/src/util/array'
import * as object from '../../yox-common/src/util/object'

/**
 * 计算属性
 *
 * 可配置 cache、deps、get、set 等
 */
export default class Computed<T> implements ComputedInterface<T> {

  static current?: Computed<any>

  keypath: string

  value: any

  deps: string[]

  cache: boolean

  fixed: boolean

  context: any

  observer: ObserverInterface<T>

  getter: ComputedGetter<T>

  setter: ComputedSetter<T> | void

  watcher: Watcher<T>

  watcherOptions: WatcherOptions<T>

  unique: Record<string, boolean>

  constructor(
    keypath: string,
    sync: boolean,
    cache: boolean,
    deps: string[],
    observer: ObserverInterface<T>,
    getter: ComputedGetter<T>,
    setter: ComputedSetter<T> | void
  ) {

    const instance = this

    instance.keypath = keypath
    instance.cache = cache

    instance.deps = deps

    instance.context = observer.context
    instance.observer = observer
    instance.getter = getter
    instance.setter = setter

    instance.unique = {}

    instance.watcher = function ($0: any, $1: any, $2: string) {

      // 计算属性的依赖变了会走进这里

      const oldValue = instance.value,
      newValue = instance.get(env.TRUE)

      if (newValue !== oldValue) {
        observer.diff(keypath, newValue, oldValue)
      }

    }

    instance.watcherOptions = {
      sync,
      watcher: instance.watcher
    }

    if (instance.fixed = !array.falsy(deps)) {
      array.each(
        deps,
        function (dep: string) {
          observer.watch(
            dep,
            instance.watcherOptions
          )
        }
      )
    }

  }

  /**
   * 读取计算属性的值
   *
   * @param force 是否强制刷新缓存
   */
  get(force?: boolean): any {

    const instance = this,

    { getter, context } = instance

    // 禁用缓存
    if (!instance.cache) {
      instance.value = execute(getter, context)
    }

    // 减少取值频率，尤其是处理复杂的计算规则
    else if (force || !object.has(instance, env.RAW_VALUE)) {

      // 如果写死了依赖，则不需要收集依赖
      if (instance.fixed) {
        instance.value = execute(getter, context)
      }
      else {

        // 清空上次收集的依赖
        instance.unbind()

        // 开始收集新的依赖
        const lastComputed = Computed.current
        Computed.current = instance

        instance.value = execute(getter, context)

        // 绑定新的依赖
        instance.bind()

        Computed.current = lastComputed
      }

    }

    return instance.value
  }

  set(value: any): void {
    const { setter, context } = this
    if (setter) {
      setter.call(context, value)
    }
  }

  /**
   * 添加依赖
   *
   * 这里只是为了保证依赖唯一，最后由 bind() 实现绑定
   *
   * @param dep
   */
  add(dep: string): void {
    this.unique[dep] = env.TRUE
  }

  /**
   * 绑定依赖
   */
  bind(): void {

    const { unique, deps, observer, watcherOptions } = this

    object.each(
      unique,
      function (_: any, dep: string) {
        array.push(deps, dep)
        observer.watch(
          dep,
          watcherOptions
        )
      }
    )

    // 用完重置
    // 方便下次收集依赖
    this.unique = {}

  }

  /**
   * 解绑依赖
   */
  unbind(): void {

    const { deps, observer, watcher } = this

    array.each(
      deps,
      function (dep: string) {
        observer.unwatch(dep, watcher)
      },
      env.TRUE
    )

    deps.length = 0

  }

}