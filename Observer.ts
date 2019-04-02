import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as char from 'yox-common/util/char'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as string from 'yox-common/util/string'
import * as nextTask from 'yox-common/util/nextTask'
import * as keypathUtil from 'yox-common/util/keypath'

import toNumber from 'yox-common/function/toNumber'
import execute from 'yox-common/function/execute'
import Emitter from 'yox-common/util/Emitter'
import Computed from './Computed';
import isFuzzyKeypath from './function/isFuzzyKeypath';
import matchFuzzyKeypath from './function/matchFuzzyKeypath';
import matchBest from './function/matchBest';
import diffObject from './function/diffObject';
import diffArray from './function/diffArray';
import readValue from './function/readValue';
import diffString from './function/diffString';

const WATCH_CONFIG_IMMEDIATE = 'immediate'
const WATCH_CONFIG_SYNC = 'sync'
const WATCH_CONFIG_ONCE = 'once'

const watchConfigList = [WATCH_CONFIG_IMMEDIATE, WATCH_CONFIG_SYNC, WATCH_CONFIG_ONCE]

/**
 * 观察者有两种观察模式：
 *
 * 1. 同步监听
 * 2. 异步监听
 *
 * 对于`计算属性`这种需要实时变化的对象，即它的依赖变了，它需要立即跟着变，否则会出现不一致的问题
 * 这种属于同步监听
 *
 * 对于外部调用 observer.watch('keypath', listener)，属于异步监听，它只关心是否变了，而不关心是否是立即触发的
 */
export default class Observer {

  context: any

  syncEmitter = new Emitter()

  asyncEmitter = new Emitter()

  asyncChanges = { }

  computed: any

  reversedComputedKeys?: string[]

  pendding: boolean

  constructor(context?: any, computed = env.NULL, public data = {}) {

    const instance = this

    instance.context = context || instance

    if (computed) {
      object.each(
        computed,
        function (item, keypath) {
          instance.addComputed(keypath, item)
        }
      )
    }

  }

  onChange(oldValue, keypath) {

    let instance = this, changes = string.startsWith(keypath, '$')
      ? (instance.$changes || (instance.$changes = {}))
      : (instance.changes || (instance.changes = {}))

    if (!object.has(changes, keypath)) {
      changes[keypath] = oldValue
    }

    if (!instance.pending) {
      instance.pending = env.TRUE
      instance.nextTick(
        function () {
          if (instance.pending) {

            let { changes, $changes, asyncEmitter } = instance

            instance.pending =
              instance.changes =
              instance.$changes = env.NULL

            let listenerKeys = object.keys(asyncEmitter.listeners)

            let eachChange = function (oldValue, keypath) {
              let newValue = instance.get(keypath)
              if (newValue !== oldValue) {
                let args = [newValue, oldValue, keypath]
                asyncEmitter.fire(keypath, args)
                array.each(
                  listenerKeys,
                  function (key) {
                    if (isFuzzyKeypath(key) && matchFuzzyKeypath(keypath, key)) {
                      asyncEmitter.fire(key, args)
                    }
                  }
                )
              }
            }

            $changes && object.each($changes, eachChange)
            changes && object.each(changes, eachChange)

          }
        }
      )
    }

  }

  /**
   * 获取数据
   *
   * @param keypath
   * @param defaultValue
   * @return
   */
  get(keypath: string, defaultValue?: any): any {

    if (!is.string(keypath) || isFuzzyKeypath(keypath)) {
      return
    }

    const instance = this

    // 传入 '' 获取整个 data
    if (keypath === char.CHAR_BLANK) {
      return instance.data
    }

    // 调用 get 时，外面想要获取依赖必须设置是谁在收集依赖
    // 如果没设置，则跳过依赖收集
    if (Computed.current) {
      Computed.current.add(keypath)
    }

    let result: any

    const { computed, reversedComputedKeys } = instance
    if (computed) {
      let target = computed[keypath]
      if (target) {
        return target.get()
      }
      const match = matchBest(reversedComputedKeys, keypath)
      if (match && match.prop) {
        target = computed[match.name].get()
        if (target != env.NULL) {
          result = object.get(target, match.prop)
        }
      }
    }

    if (!result) {
      result = object.get(instance.data, keypath)
    }

    return result ? result.value : defaultValue

  }

  /**
   * 更新数据
   *
   * @param keypath
   * @param value
   */
  set(keypath: any, value: any) {

    const instance = this,

    { syncEmitter, asyncEmitter } = instance,

    // 设值要触发`同步`监听
    syncKeypaths = object.keys(syncEmitter.listeners),

    // 设值要触发`同步`监听
    asyncKeypaths = object.keys(asyncEmitter.listeners),

    // 三个元素算作一个整体
    // 第一个表示监听的 keypath
    // 第二个表示旧值
    // 第三个表示实际的 keypath
    asyncChanges = [],

    setValue = function (value: any, keypath: string) {

      const oldValue = instance.get(keypath)
      if (value === oldValue) {
        return
      }

      const syncChanges = []

      // 在真正设值之前调用，可取到 oldValue
      addChange(syncKeypaths, syncChanges, keypath, value, oldValue)
      addChange(asyncKeypaths, asyncChanges, keypath, value, oldValue)

      const { computed, reversedComputedKeys } = instance

      let target: Computed
      if (computed) {
        target = computed[keypath]
        if (target) {
          target.set(value)
        }
        else {
          const match = matchBest(reversedComputedKeys, keypath)
          if (match && match.prop) {
            target = computed[match.name]
            const targetValue = target.get()
            if (is.object(targetValue) || is.array(targetValue)) {
              object.set(targetValue, match.prop, value)
            }
          }
        }
      }

      // 没命中计算属性，则正常设值
      if (!target) {
        object.set(instance.data, keypath, value)
      }

      // 触发同步监听


    },

    addChange = function (watchKeypaths: string[], keypath: string, newValue: any, oldValue: any) {

      const fuzzyKeypaths = [], changes = []

      // 遍历监听的 keypath，如果未被监听，则无需触发任何事件
      array.each(
        watchKeypaths,
        function (watchKeypath) {

          // 模糊监听，如 users.*.name
          if (isFuzzyKeypath(watchKeypath)) {

            // 如果当前修改的是 users.0 整个对象
            // users.0 和 users.*.name 无法匹配
            // 此时要知道设置 users.0 到底会不会改变 users.*.name 需要靠递归了

            // 如果匹配，则无需递归
            if (matchFuzzyKeypath(keypath, watchKeypath)) {
              changes.push(
                watchKeypath, keypath, oldValue
              )
            }
            else {
              array.push(
                fuzzyKeypaths,
                watchKeypath
              )
            }

            return
          }

          // 不是模糊匹配，直接靠前缀匹配
          // 比如监听的是 users.0.name，此时修改 users.0，则直接读出子属性值，判断是否相等
          const length = keypathUtil.match(watchKeypath, keypath)
          if (length >= 0) {
            const subKeypath = string.slice(watchKeypath, length),
            subNewValue = readValue(newValue, subKeypath),
            subOldValue = readValue(oldValue, subKeypath)
            if (subNewValue !== subOldValue) {
              changes.push(
                watchKeypath, watchKeypath, subOldValue
              )
            }
          }

        }
      )

      // 存在模糊匹配的需求
      // 必须对数据进行递归
      // 性能确实会慢一些，但是很好用啊，几乎可以监听所有的数据
      if (fuzzyKeypaths.length) {
        addFuzzyChange(fuzzyKeypaths, changes, keypath, newValue, oldValue)
      }

    },

    addFuzzyChange = function (fuzzyKeypaths: string[], changes: any[], keypath: string, newValue: any, oldValue: any) {
      if (newValue !== oldValue) {

        // fuzzyKeypaths 全是模糊的 keypath

        array.each(
          fuzzyKeypaths,
          function (fuzzyKeypath) {
            if (matchFuzzyKeypath(keypath, fuzzyKeypath)) {
              changes.push(
                fuzzyKeypath, oldValue, keypath
              )
            }
          }
        )

        // 我们认为 $ 开头的变量是不可递归的
        // 比如浏览器中常见的 $0 表示当前选中元素
        // DOM 元素是不能递归的
        if (char.codeAt(keypath) === 36) {
          return
        }

        let diffCallback = function (newValue: any, oldValue: any, propName: string | number) {
          addFuzzyChange(
            fuzzyKeypaths,
            newValue,
            oldValue,
            keypathUtil.join(keypath, propName)
          )
        }

        // 先 array 再 object
        // 因为 array 也是一种 object

        diffString(newValue, oldValue, diffCallback)
          || diffArray(newValue, oldValue, diffCallback)
          || diffObject(newValue, oldValue, diffCallback)

      }
    }


    /**
     * 设值会遍历监听的每个 keypath
     * 如果监听项疑似变化，则会加入对应的数组
     *
     */


    if (is.string(keypath)) {
      setValue(value, keypath)
    }
    else if (is.object(keypath)) {
      object.each(keypath, setValue)
    }

  }

  /**
   * 添加计算属性
   *
   * @param keypath
   * @param computed
   */
  addComputed(keypath: string, options: any): Computed | void {

    const instance = this,
    computed = Computed.build(keypath, instance.context, options)

    if (computed) {

      if (!instance.computed) {
        instance.computed = {}
      }

      instance.computed[keypath] = computed
      instance.reversedComputedKeys = object.sort(instance.computed, env.TRUE)

      return computed

    }

  }

  /**
   * 移除计算属性
   *
   * @param keypath
   */
  removeComputed(keypath: string) {

    const instance = this,
    { computed } = instance

    if (computed && object.has(computed, keypath)) {
      delete computed[keypath]
      instance.reversedComputedKeys = object.sort(computed, env.TRUE)
    }

  }

  /**
   * 监听数据变化
   *
   * @param keypath
   * @param watcher
   * @param options
   * @param options.immediate 是否立即触发一次
   * @param options.sync 是否同步响应，默认是异步
   * @param options.once 是否监听一次
   */
  watch(keypath: any, watcher?: any, options?: any) {

    const instance = this,

    { context, syncEmitter, asyncEmitter } = instance,

    bind = function (keypath: string, func: Function, options: Object) {

      const emitter = options[WATCH_CONFIG_SYNC] ? syncEmitter : asyncEmitter

      emitter[options[WATCH_CONFIG_ONCE] ? 'once' : 'on'](
        keypath,
        {
          func,
          context,
        }
      )

      if (options[WATCH_CONFIG_IMMEDIATE]) {
        execute(
          func,
          context,
          [
            instance.get(keypath),
            env.UNDEFINED,
            keypath
          ]
        )
      }

    }

    if (is.string(keypath)) {
      bind(keypath, watcher, options || env.plain)
      return
    }

    const globalOptions = watcher || env.plain

    object.each(
      keypath,
      function (value, keypath) {
        let watcher = value, options: any = object.extend({}, globalOptions)
        if (is.object(value)) {
          watcher = value.watcher
          array.each(
            watchConfigList,
            function (field) {
              if (is.boolean(value[field])) {
                options[field] = value[field]
              }
            }
          )
        }
        bind(keypath, watcher, options)
      }
    )

  }

  /**
   * 取消监听数据变化
   *
   * @param {string|Object} keypath
   * @param {Function} watcher
   */
  unwatch(keypath: any, watcher?: Function) {
    const { syncEmitter, asyncEmitter } = this,
    unbind = function (watcher: Function, keypath: string) {
      syncEmitter.off(keypath, watcher)
      asyncEmitter.off(keypath, watcher)
    }
    if (is.string(keypath)) {
      unbind(watcher, keypath)
    }
    else if (is.object(keypath)) {
      object.each(keypath, unbind)
    }
  }

  /**
   * 取反 keypath 对应的数据
   *
   * 不管 keypath 对应的数据是什么类型，操作后都是布尔型
   *
   * @param keypath
   * @return 取反后的布尔值
   */
  toggle(keypath: string): boolean {
    let value = !this.get(keypath)
    this.set(keypath, value)
    return value
  }

  /**
   * 递增 keypath 对应的数据
   *
   * 注意，最好是整型的加法，如果涉及浮点型，不保证计算正确
   *
   * @param keypath 值必须能转型成数字，如果不能，则默认从 0 开始递增
   * @param step 步进值，默认是 1
   * @param min 可以递增到的最小值，默认不限制
   */
  increase(keypath: string, step = 1, max?: number): number | void {
    const value = toNumber(this.get(keypath), 0) + step
    if (!is.number(max) || value <= max) {
      this.set(keypath, value)
      return value
    }
  }

  /**
   * 递减 keypath 对应的数据
   *
   * 注意，最好是整型的减法，如果涉及浮点型，不保证计算正确
   *
   * @param keypath 值必须能转型成数字，如果不能，则默认从 0 开始递减
   * @param step 步进值，默认是 1
   * @param min 可以递减到的最小值，默认不限制
   */
  decrease(keypath: string, step = 1, min?: number): number | void {
    const value = toNumber(this.get(keypath), 0) - step
    if (!is.numeric(min) || value >= min) {
      this.set(keypath, value)
      return value
    }
  }

  /**
   * 在数组指定位置插入元素
   *
   * @param keypath
   * @param item
   * @param index
   */
  insert(keypath: string, item: any, index: any): boolean {

    let list = this.get(keypath)
    list = !is.array(list) ? [] : object.copy(list)

    let { length } = list
    if (index === env.TRUE || index === length) {
      list.push(item)
    }
    else if (index === env.FALSE || index === 0) {
      list.unshift(item)
    }
    else if (index > 0 && index < length) {
      list.splice(index, 0, item)
    }
    else {
      return
    }

    this.set(keypath, list)

    return env.TRUE

  }

  /**
   * 通过索引移除数组中的元素
   *
   * @param keypath
   * @param index
   */
  removeAt(keypath: string, index: number): boolean {
    let list = this.get(keypath)
    if (is.array(list)
      && index >= 0
      && index < list.length
    ) {
      list = object.copy(list)
      list.splice(index, 1)
      this.set(keypath, list)
      return env.TRUE
    }
  }

  /**
   * 直接移除数组中的元素
   *
   * @param keypath
   * @param item
   */
  remove(keypath: string, item: any): boolean {
    let list = this.get(keypath)
    if (is.array(list)) {
      list = object.copy(list)
      if (array.remove(list, item)) {
        this.set(keypath, list)
        return env.TRUE
      }
    }
  }

  /**
   * 新增异步任务
   *
   * @param task
   */
  nextTick(task: Function) {
    const instance = this
    nextTask.append(
      function () {
        // 确保没销毁
        if (instance.data) {
          task()
        }
      }
    )
  }

  nextRun() {
    nextTask.run()
  }

  /**
   * 销毁
   */
  destroy() {
    this.syncEmitter.off()
    this.asyncEmitter.off()
    object.clear(this)
  }

}
