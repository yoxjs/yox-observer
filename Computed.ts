import execute from 'yox-common/function/execute'
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as array from 'yox-common/util/array'
import * as logger from 'yox-common/util/logger'

/**
 * 计算属性
 *
 * 可配置 cache、dep、get 等
 */
export class Computed {

  static current?: Computed

  /**
   * 对外的构造器，把用户配置的计算属性对象转换成内部对象
   *
   * @param keypath
   * @param context
   * @param options
   */
  static build(keypath: string, context: any, options: any): Computed | void {

    let cache = env.TRUE, deps = [], getter: Function, setter: Function

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

    if (getter || setter) {
      return new Computed(keypath, cache, deps, getter, setter, context)
    }

  }

  value: any
  frozen: boolean

  private constructor(
    public keypath: string, public cache: boolean, public deps: string[],
    public getter: Function, public setter: Function, public context: any
  ) {

    const instance = this

    if (deps.length > 0) {
      array.each(
        deps,
        function (dep) {
          instance.add(dep)
        }
      )
      instance.frozen = env.TRUE
    }

    instance.update = function () {

      let oldValue = instance.value
      if (instance.get(env.TRUE) !== oldValue) {

      }

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
    const instance = this
    if (instance.setter) {
      instance.setter.call(instance.context, value)
    }
  }

  /**
   * 计算属性是否包含依赖
   *
   * @param dep
   */
  has(dep: string) {
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
      instance.observer.watch(dep, instance.update, env.FALSE, instance)
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
      instance.observer.unwatch(dep, instance.update)
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