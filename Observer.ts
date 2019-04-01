
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
import matchBest from './function/matchBest';
import matchKeypath from './function/matchKeypath';
import diffObject from './function/diffObject';
import diffArray from './function/diffArray';
import readValue from './function/readValue';


export default class Observer {

  context: any

  emitter: Emitter

  asyncEmitter: Emitter

  computed: any

  reversedComputedKeys?: string[]

  constructor(context?: any, computed = env.NULL, public data = {}) {

    let instance = this

    instance.context = context || instance
    instance.emitter = new Emitter()
    instance.asyncEmitter = new Emitter()

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
                    if (isFuzzyKeypath(key) && matchKeypath(keypath, key)) {
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

    const instance = this

    const { emitter } = instance

    // 同步监听的 keypath
    let listenKeypaths = object.keys(emitter.listeners)

    // 三个元素算一个整体，第一个表示监听的 keypath，第二个表示旧值，第三个表示实际的 keypath
    let changes = []

    let addFuzzyChange = function (fuzzyKeypaths: string[], newValue: any, oldValue: any, key: string) {
      if (newValue !== oldValue) {

        array.each(
          fuzzyKeypaths,
          function (fuzzyKeypath) {
            if (matchKeypath(key, fuzzyKeypath)) {
              changes.push(
                fuzzyKeypath, oldValue, key
              )
            }
          }
        )

        // 我们认为 $ 开头的变量是不可递归的
        // 比如浏览器中常见的 $0 表示当前选中元素
        // DOM 元素是不能递归的
        if (string.startsWith(key, '$')) {
          return
        }

        let newIs = is.string(newValue), oldIs = is.string(oldValue)
        if (newIs || oldIs) {
          addFuzzyChange(
            fuzzyKeypaths,
            newIs ? newValue[env.RAW_LENGTH] : env.UNDEFINED,
            oldIs ? oldValue[env.RAW_LENGTH] : env.UNDEFINED,
            keypathUtil.join(key, env.RAW_LENGTH)
          )
        }
        else {
          newIs = is.object(newValue), oldIs = is.object(oldValue)
          if (newIs || oldIs) {
            diffObject(
              newIs && newValue,
              oldIs && oldValue,
              function (newValue, oldValue, prop) {
                addFuzzyChange(
                  fuzzyKeypaths,
                  newValue,
                  oldValue,
                  keypathUtil.join(key, prop)
                )
              }
            )
          }
          else {
            diffArray(
              is.array(newValue) && newValue,
              is.array(oldValue) && oldValue,
              function (newValue, oldValue, index) {
                addFuzzyChange(
                  fuzzyKeypaths,
                  newValue,
                  oldValue,
                  keypathUtil.join(key, index)
                )
              }
            )
          }
        }

      }
    }

    let addChange = function (newValue: any, oldValue: any, keypath: string) {

      let fuzzyKeypaths = []

      array.each(
        listenKeypaths,
        function (listenKeypath) {
          if (isFuzzyKeypath(listenKeypath)) {
            if (matchKeypath(keypath, listenKeypath)) {
              changes.push(
                listenKeypath, oldValue, keypath
              )
            }
            else {
              array.push(
                fuzzyKeypaths, listenKeypath
              )
            }
          }
          else {
            let listenNewValue: any, listenOldValue: any
            if (listenKeypath === keypath) {
              listenNewValue = newValue
              listenOldValue = oldValue
            }
            else {
              let length = keypathUtil.match(listenKeypath, keypath)
              if (length > 0) {
                let propName = string.slice(listenKeypath, length)
                listenNewValue = readValue(newValue, propName)
                listenOldValue = readValue(oldValue, propName)
              }
            }
            if (listenNewValue !== listenOldValue) {
              changes.push(
                listenKeypath, listenOldValue, listenKeypath
              )
            }
          }
        }
      )

      // 存在模糊匹配的需求
      // 必须对数据进行递归
      // 性能确实会慢一些，但是很好用啊，几乎可以监听所有的数据
      if (fuzzyKeypaths.length) {
        addFuzzyChange(fuzzyKeypaths, newValue, oldValue, keypath)
      }

    }

    let setValue = function (value: any, keypath: string) {

      const oldValue = instance.get(keypath)
      if (value === oldValue) {
        return
      }

      addChange(value, oldValue, keypath)

      const { computed, reversedComputedKeys } = instance
      if (computed) {
        let target = computed[keypath]
        if (target) {
          target.set(value)
          return
        }
        const match = matchBest(reversedComputedKeys, keypath)
        if (match && match.prop) {
          target = computed[match.name].get()
          if (!is.primitive(target)) {
            object.set(target, match.prop, value)
          }
          return
        }
      }
      object.set(instance.data, keypath, value)

    }

    if (is.string(keypath)) {
      setValue(value, keypath)
    }
    else if (is.object(keypath)) {
      object.each(keypath, setValue)
    }

    for (let i = 0; i < changes[env.RAW_LENGTH]; i += 3) {
      emitter.fire(
        changes[i],
        [
          changes[i + 1],
          changes[i + 2],
          addChange
        ]
      )
    }

  }

  /**
   * 添加计算属性
   *
   * @param keypath
   * @param computed
   */
  addComputed(keypath: string, options: any): Computed | void {

    const instance = this
    const computed = Computed.build(keypath, instance.context, options)

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
   * 监听数据变化
   *
   * @param keypath
   * @param watcher
   * @param sync
   */
  watch(keypath: string | Object, watcher: Function | boolean, sync = false, computed = env.NULL) {

    const instance = this

    const watch = function (instance, keypath, func, sync, computed) {

      let { context } = instance

      // 同步回调
      let syncFunc

      if (!computed) {
        // 不用直接引用 instance.onChange
        // 避免 onChange 被多处引用，解绑会出问题
        syncFunc = function (oldValue, keypath) {
          instance.onChange(oldValue, keypath)
        }
        func.link = syncFunc

        // 设置异步回调
        instance.asyncEmitter[action](
          keypath,
          {
            func,
            context,
          }
        )
      }

      instance.emitter[action](
        keypath,
        {
          func: syncFunc || func,
          context: computed || instance,
        }
      )

      if (sync) {
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
      watch(instance, keypath, watcher, sync, computed)
    }
    else {
      if (watcher === env.TRUE) {
        computed = sync
        sync = watcher
      }
      object.each(
        keypath,
        function (value, keypath) {
          let itemWatcher = value, itemSync = sync
          if (is.object(value)) {
            itemWatcher = value.watcher
            if (is.boolean(value.sync)) {
              itemSync = value.sync
            }
          }
          watch(instance, keypath, itemWatcher, itemSync, computed)
        }
      )
    }

  }

  /**
   * 监听数据变化
   *
   * @param keypath
   * @param  watcher
   * @param sync
   */
  watchOnce(keypath: string | Object, watcher: Function | boolean, sync = false, computed = env.NULL) {

  }

  /**
   * 取消监听数据变化
   *
   * @param {string|Object} keypath
   * @param {Function} watcher
   */
  unwatch(keypath: any, watcher: Function) {
    let { emitter, asyncEmitter } = this
    let off = function (watcher: Function, keypath: string) {
      emitter.off(keypath, watcher.link || watcher)
      asyncEmitter.off(keypath, watcher)
    }
    if (is.string(keypath)) {
      off(watcher, keypath)
    }
    else if (is.object(keypath)) {
      object.each(keypath, off)
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
  decrease(keypath: string, step = 1, min: number): number | void {
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
      return env.FALSE
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
    return env.FALSE
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
    return env.FALSE
  }

  nextTick(fn: Function) {
    if (is.func(fn)) {
      let instance = this
      nextTask.append(
        function () {
          // 确保没销毁
          if (instance.data) {
            fn()
          }
        }
      )
    }
  }

  nextRun() {
    nextTask.run()
  }

  /**
   * 销毁
   */
  destroy() {
    this.emitter.off()
    this.asyncEmitter.off()
    object.clear(this)
  }

}
