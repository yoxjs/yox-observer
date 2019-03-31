import isDef from 'yox-common/function/isDef'
import execute from 'yox-common/function/execute'
import * as env from 'yox-common/util/env'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as logger from 'yox-common/util/logger'

let guid = 0

export class Computed {

  static current?: Computed

  id: number
  value: any
  frozen: boolean
  changes?: Object = env.UNDEFINED

  constructor(public keypath: string, public cache: boolean, public deps: string[], public getter: () => any, public context: any) {

    const instance = this

    instance.id = ++guid
    instance.deps = []

    if (deps.length > 0) {
      array.each(
        deps,
        function (dep) {
          instance.addDep(dep)
        }
      )
      instance.frozen = env.TRUE
    }

    instance.update = function (oldValue, key, addChange) {

      let value = instance.value, changes = instance.changes || (instance.changes = {})

      // 当前计算属性的依赖发生变化
      if (!object.has(changes, key)) {
        changes[key] = oldValue
      }

      // 把依赖和计算属性自身注册到下次可能的变化中
      observer.onChange(oldValue, key)
      observer.onChange(value, keypath)

      // 当前计算属性是否是其他计算属性的依赖
      let diff = function () {
        let newValue = instance.get()
        if (newValue !== value) {
          addChange(newValue, value, keypath)
          return env.FALSE
        }
      }

      object.each(
        observer.computed,
        function (computed) {
          if (computed[env.RAW_KEYPATH] !== keypath) {
            let { deps } = computed
            if (array.has(deps, keypath)) {
              return diff()
            }
            else {
              for (let i = 0, len = deps[env.RAW_LENGTH]; i < len; i++) {
                if (keypathUtil.startsWith(deps[i], keypath)) {
                  return diff()
                }
              }
            }
          }
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

    const instance = this
    const { getter, context } = instance

    // 禁用缓存
    if (!instance.cache) {
      instance.value = execute(getter, context)
    }

    // 减少取值频率，尤其是处理复杂的计算规则
    else if (force || instance.isDirty()) {

      // 如果写死了依赖，则不需要收集依赖
      if (instance.frozen) {
        instance.value = execute(getter, context)
      }
      else {
        // 清空上次收集的依赖
        instance.clearDep()

        // 开始收集新的依赖
        let lastComputed = Computed.current
        Computed.current = instance
        instance.value = execute(getter, context)
        Computed.current = lastComputed

        // 刷新 changes
        instance.changes = env.NULL
      }

    }
    return instance.value
  }

  /**
   * 计算属性是否包含依赖
   *
   * @param dep
   */
  hasDep(dep: string) {
    return array.has(this.deps, dep)
  }

  /**
   * 添加依赖
   *
   * @param dep
   */
  addDep(dep: string) {
    const instance = this
    instance.checkFrozen()
    if (!instance.hasDep(dep)) {
      array.push(instance.deps, dep)
      instance.observer.watch(dep, instance.update, env.FALSE, instance)
    }
  }

  /**
   * 移除依赖
   *
   * @param dep
   */
  removeDep(dep: string) {
    const instance = this
    instance.checkFrozen()
    if (array.remove(instance.deps, dep) > 0) {
      instance.observer.unwatch(dep, instance.update)
    }
  }

  /**
   * 清空依赖
   */
  clearDep() {
    const instance = this
    instance.checkFrozen()
    array.each(
      instance.deps,
      function (dep) {
        instance.removeDep(dep)
      },
      env.TRUE
    )
  }

  checkFrozen() {
    if (this.frozen) {
      logger.fatal('the computed object is frozen, you can not modify deps')
    }
  }

  isDirty() {
    let { observer, changes } = this, result
    if (changes) {
      for (let key in changes) {
        if (changes[key] !== observer.get(key)) {
          return env.TRUE
        }
      }
    }
    // undefined 表示第一次执行，要返回 true
    return !isDef(changes)
  }

}