import execute from 'yox-common/function/execute'

import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'

import * as type from 'yox-type/src/type'
import Observer from 'yox-type/src/Observer'
import WatcherOptions from 'yox-type/src/WatcherOptions'

const syncWatcherOptions: WatcherOptions = { sync: env.TRUE },

asyncWatcherOptions: WatcherOptions = { sync: env.FALSE }

/**
 * 计算属性
 *
 * 可配置 cache、deps、get、set 等
 */
export default class Computed {

  static current?: Computed

  /**
   * 对外的构造器，把用户配置的计算属性对象转换成内部对象
   *
   * @param keypath
   * @param observer
   * @param options
   */
  static build(keypath: string, observer: Observer, options: any): Computed | void {

    let cache = env.TRUE,

    sync = env.TRUE,

    deps = env.EMPTY_ARRAY,

    getter: type.computedGetter | void,

    setter: type.computedSetter | void

    if (is.func(options)) {
      getter = options
    }
    else if (is.object(options)) {
      if (is.boolean(options.cache)) {
        cache = options.cache
      }
      if (is.boolean(options.sync)) {
        sync = options.sync
      }
      if (is.array(options.deps)) {
        deps = options.deps
      }
      if (is.func(options.get)) {
        getter = options.get
      }
      if (is.func(options.set)) {
        setter = options.set
      }
    }

    if (getter) {
      return new Computed(keypath, sync, cache, deps, observer, getter, setter)
    }

  }

  keypath: string

  value: any

  deps: string[]

  sync: boolean

  cache: boolean

  fixed: boolean

  context: any

  observer: Observer

  getter: type.computedGetter
  setter: type.computedSetter | void
  callback: type.watcher

  private constructor(
    keypath: string,
    sync: boolean,
    cache: boolean,
    deps: string[],
    observer: Observer,
    getter: type.computedGetter,
    setter: type.computedSetter | void
  ) {

    const instance = this

    instance.keypath = keypath
    instance.sync = sync
    instance.cache = cache
    // 因为可能会修改 deps，所以这里创建一个自己的对象，避免影响外部传入的 deps
    instance.deps = []

    instance.context = observer.context
    instance.observer = observer
    instance.getter = getter
    instance.setter = setter

    instance.callback = function ($0: any, $1: any, $2: string) {

      // 计算属性的依赖变了会走进这里

      const oldValue = instance.value,
      newValue = instance.get(env.TRUE)

      if (newValue !== oldValue) {
        observer.diffSync(keypath, newValue, oldValue)
      }

    }

    if (instance.fixed = !array.falsy(deps)) {
      array.each(
        deps,
        function (dep) {
          instance.add(dep)
        }
      )
    }

  }

  /**
   * 读取计算属性的值
   *
   * @param force 是否强制刷新缓存
   */
  get(force = false): any {

    const instance = this,

    { getter, context } = instance

    // 禁用缓存
    if (!instance.cache) {
      instance.value = execute(getter, context)
    }

    // 减少取值频率，尤其是处理复杂的计算规则
    else if (force || !object.has(instance, 'value')) {

      // 如果写死了依赖，则不需要收集依赖
      if (instance.fixed) {
        instance.value = execute(getter, context)
      }
      else {
        // 清空上次收集的依赖
        instance.clear()

        // 开始收集新的依赖
        const lastComputed = Computed.current
        Computed.current = instance
        instance.value = execute(getter, context)
        Computed.current = lastComputed
      }

    }

    return instance.value
  }

  set(value: any) {
    const { setter, context } = this
    if (setter) {
      setter.call(context, value)
    }
  }

  /**
   * 计算属性是否包含依赖
   *
   * @param dep
   */
  has(dep: string): boolean {
    return array.has(this.deps, dep)
  }

  /**
   * 添加依赖
   *
   * @param dep
   */
  add(dep: string) {
    const instance = this
    if (!instance.has(dep)) {
      array.push(instance.deps, dep)
      instance.observer.watch(
        dep,
        instance.callback,
        instance.sync ? syncWatcherOptions : asyncWatcherOptions
      )
    }
  }

  /**
   * 移除依赖
   *
   * @param dep
   */
  remove(dep: string) {
    const instance = this
    if (array.remove(instance.deps, dep) > 0) {
      instance.observer.unwatch(dep, instance.callback)
    }
  }

  /**
   * 清空依赖
   */
  clear() {
    const instance = this
    array.each(
      instance.deps,
      function (dep) {
        instance.remove(dep)
      },
      env.TRUE
    )
  }

}