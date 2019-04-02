import execute from 'yox-common/function/execute'
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as array from 'yox-common/util/array'
import * as logger from 'yox-common/util/logger'
import Observer from './Observer'

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
  static build(keypath: string, observer: any, options: any): Computed | void {

    let cache = env.TRUE, deps = [], getter: Function | void, setter: Function | void

    if (is.func(options)) {
      getter = options
    }
    else if (is.object(options)) {
      if (is.boolean(options.cache)) {
        cache = options.cache
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
      return new Computed(keypath, cache, deps, observer, getter, setter)
    }

  }

  value: any

  frozen: boolean

  context: any

  callback: Function

  private constructor(
    public keypath: string, public cache: boolean, public deps: string[],
    public observer: Observer, public getter: Function, public setter: Function | void
  ) {

    const instance = this

    instance.context = observer.context

    instance.callback = function () {
      const oldValue = instance.value,
      newValue = instance.get(env.TRUE)
      if (newValue !== oldValue) {
        observer.diffSync(keypath, newValue, oldValue)
      }
    }

    if (!array.falsy(deps)) {
      array.each(
        deps,
        function (dep) {
          instance.add(dep)
        }
      )
      instance.frozen = env.TRUE
    }

  }

  /**
   * 读取计算属性的值
   *
   * @param force 是否强制刷新缓存
   */
  get(force = false): any {

    const instance = this
    const { getter, context } = instance

    // 禁用缓存
    if (!instance.cache) {
      instance.value = execute(getter, context)
    }

    // 减少取值频率，尤其是处理复杂的计算规则
    else if (force) {

      // 如果写死了依赖，则不需要收集依赖
      if (instance.frozen) {
        instance.value = execute(getter, context)
      }
      else {
        // 清空上次收集的依赖
        instance.clear()

        // 开始收集新的依赖
        let lastComputed = Computed.current
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
    instance.checkFrozen()
    if (!instance.has(dep)) {
      array.push(instance.deps, dep)
      instance.observer.watch(dep, instance.callback, {
        sync: env.TRUE
      })
    }
  }

  /**
   * 移除依赖
   *
   * @param dep
   */
  remove(dep: string) {
    const instance = this
    instance.checkFrozen()
    if (array.remove(instance.deps, dep) > 0) {
      instance.observer.unwatch(dep, instance.callback)
    }
  }

  /**
   * 清空依赖
   */
  clear() {
    const instance = this
    instance.checkFrozen()
    array.each(
      instance.deps,
      function (dep) {
        instance.remove(dep)
      },
      env.TRUE
    )
  }

  checkFrozen() {
    if (this.frozen) {
      logger.fatal('the computed object is frozen, you can not modify deps')
    }
  }

}