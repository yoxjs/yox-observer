
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as string from 'yox-common/util/string'
import * as nextTask from 'yox-common/util/nextTask'
import * as keypathUtil from 'yox-common/util/keypath'

import isDef from 'yox-common/function/isDef'
import toNumber from 'yox-common/function/toNumber'
import execute from 'yox-common/function/execute'
import Emitter from 'yox-common/util/Emitter'

/**
 * 记录对比值
 *
 * @param {?Object} changes
 * @param {*} newValue
 * @param {*} oldValue
 * @param {string} keypath
 */
function updateValue(changes, newValue, oldValue, keypath) {
  if (!changes) {
    changes = { }
  }
  if (changes[ keypath ]) {
    changes[ keypath ].newValue = newValue
  }
  else {
    changes[ keypath ] = {
      newValue,
      oldValue,
    }
  }
  return changes
}

/**
 * 遍历 keypath 的每一段
 *
 * @param {string} keypath
 * @param {Function} callback
 */
function eachKeypath(keypath, callback) {
  if (callback(keypath) !== env.FALSE) {
    for (let i = keypath.length - 1; i >= 0;) {
      i = string.lastIndexOf(keypath, env.KEYPATH_SEPARATOR, i)
      if (i > 0) {
        if (callback(string.slice(keypath, 0, i)) === env.FALSE) {
          return
        }
        i--
      }
    }
  }
}

/**
 * 对比新旧对象
 *
 * @param {?Object} newObject
 * @param {?Object} oldObject
 * @param {Function} callback
 */
function diffObject(newObject, oldObject, callback) {

  let keys
  if (oldObject) {
    keys = object.keys(oldObject)
    if (newObject) {
      array.each(
        object.keys(newObject),
        function (key) {
          if (!array.has(keys, key)) {
            array.push(keys, key)
          }
        }
      )
    }
  }
  else if (newObject) {
    keys = object.keys(newObject)
  }
  if (keys) {
    array.each(
      keys,
      function (key) {
        callback(
          newObject ? newObject[ key ] : env.UNDEFINED,
          oldObject ? oldObject[ key ] : env.UNDEFINED,
          key
        )
      }
    )
  }
}

/**
 * 对比新旧数组
 *
 * @param {?Array} newArray
 * @param {?Array} oldArray
 * @param {Function} callback
 */
function diffArray(newArray, oldArray, callback) {

  if (newArray || oldArray) {

    let newLength = newArray ? newArray.length : 0
    let oldLength = oldArray ? oldArray.length : 0

    callback(
      newArray ? newLength : env.UNDEFINED,
      oldArray ? oldLength : env.UNDEFINED,
      'length'
    )

    for (let i = 0, length = Math.max(newLength, oldLength); i < length; i++) {
      callback(
        newArray ? newArray[ i ] : env.UNDEFINED,
        oldArray ? oldArray[ i ] : env.UNDEFINED,
        i
      )
    }

  }

}

let patternCache = { }

/**
 * 模糊匹配 Keypath
 *
 * @param {string} keypath
 * @param {string} pattern
 * @return {?Array.<string>}
 */
function matchKeypath(keypath, pattern) {
  let cache = patternCache[ pattern ]
  if (!cache) {
    cache = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '([\.\\w]+?)')
      .replace(/\*/g, '(\\w+)')
    cache = patternCache[ pattern ] = new RegExp(`^${cache}$`)
  }
  let match = keypath.match(cache)
  if (match) {
    return array.toArray(match).slice(1)
  }
}

/**
 * 是否模糊匹配
 *
 * @param {string} keypath
 * @return {boolean}
 */
function isFuzzyKeypath(keypath) {
  return string.has(keypath, '*')
}

/**
 * 从 getter 对象的所有 key 中，选择和 keypath 最匹配的那一个
 *
 * @param {Array.<string>} sorted
 * @param {string} keypath
 * @return {Object}
 */
function matchBest(sorted, keypath) {

  let result = { }

  array.each(
    sorted,
    function (prefix) {
      let length = keypathUtil.startsWith(keypath, prefix)
      if (length !== env.FALSE) {
        result.name = prefix
        result.prop = string.slice(keypath, length)
        return env.FALSE
      }
    }
  )

  return result

}

let guid = 0

export class Watcher {

  constructor(keypath, observer) {

    let instance = this

    instance.id = ++guid
    instance.keypath = keypath
    instance.observer = observer
    instance.deps = [ ]

    instance.update = function (newValue, oldValue, keypath) {
      instance.changes = updateValue(instance.changes, newValue, oldValue, keypath)
      if (keypath === instance.keypath) {
        instance.observer.onChange(newValue, oldValue, keypath, instance)
      }
    }

  }

  get(force) {
    let { value, cache } = this
    if (cache === env.FALSE) {
      value = this.value = this.getter()
    }
    // 减少取值频率，尤其是处理复杂的计算规则
    else  if (force || this.isDirty()) {
      let lastWatcher = Observer.watcher
      Observer.watcher = this
      value = this.value = this.getter()
      Observer.watcher = lastWatcher
      this.changes = env.NULL
    }
    return value
  }

  addDep(dep) {
    if (!array.has(this.deps, dep)) {
      array.push(this.deps, dep)
      this.observer.watch(dep, this.update)
    }
  }

  removeDep(dep) {
    array.remove(this.deps, dep)
    this.observer.unwatch(dep, this.update)
  }

  clearDep() {
    let instance = this
    array.each(
      instance.deps,
      function (dep) {
        instance.removeDep(dep)
      },
      env.TRUE
    )
  }

  isDirty() {
    let { changes } = this, result
    if (isDef(changes)) {
      if (changes) {
        object.each(
          changes,
          function (item, keypath) {
            if (item.newValue !== item.oldValue) {
              result = env.TRUE
              return env.FALSE
            }
          }
        )
      }
    }
    else {
      result = env.TRUE
    }
    return result
  }

}

export class Observer {

  /**
   * @param {Object} options
   * @property {Object} options.data
   * @property {?Object} options.computed
   * @property {?*} options.context 执行 watcher 函数的 this 指向
   */
  constructor(options) {

    let instance = this

    instance.id = ++guid
    instance.data = options.data || { }
    instance.context = options.context || instance
    instance.emitter = new Emitter()

    if (options.computed) {
      object.each(
        options.computed,
        function (item, keypath) {
          instance.addComputed(keypath, item)
        }
      )
    }

  }

  onChange(newValue, oldValue, keypath, watcher) {

    let instance = this

    let fireChange = function () {

      let currentChanges = instance.changes

      instance.changes = env.NULL

      let { emitter } = instance
      let listenerKeys = object.keys(emitter.listeners)

      object.each(
        currentChanges,
        function (item, keypath) {
          let { oldValue, watcher } = item
          let newValue = watcher.get()
          if (newValue !== oldValue) {
            let args = [ newValue, oldValue, keypath ]
            emitter.fire(keypath, args)
            array.each(
              listenerKeys,
              function (key) {
                if (isFuzzyKeypath(key) && matchKeypath(keypath, key)) {
                  emitter.fire(key, args)
                }
              }
            )
          }
        }
      )

    }

    // 计算属性
    // 当计算属性以 $ 开头时，表示需要异步触发 change，如模板更新
    let watchKey = watcher.keypath
    let changes = instance.changes || (instance.changes = { })

    if (!changes[ watchKey ]) {
      changes[ watchKey ] = {
        watcher,
        oldValue: watcher.value,
      }
    }

    if (string.startsWith(watchKey, '$')) {
      if (!instance.pending) {
        instance.pending = env.TRUE
        instance.nextTick(
          function () {
            if (instance.pending) {
              instance.pending = env.FALSE
              fireChange()
            }
          }
        )
      }
      return
    }

    fireChange()

  }

  /**
   * 获取数据
   *
   * @param {string} keypath
   * @param {?*} defaultValue
   * @return {?*}
   */
  get(keypath, defaultValue) {

    if (!is.string(keypath) || isFuzzyKeypath(keypath)) {
      return
    }

    let instance = this, result

    // 传入 '' 获取整个 data
    if (keypath === '') {
      return instance.data
    }

    keypath = keypathUtil.normalize(keypath)

    // 调用 get 时，外面想要获取依赖必须设置是谁在收集依赖
    // 如果没设置，则跳过依赖收集
    let watcher = Observer.watcher
    if (watcher) {
      eachKeypath(
        keypath,
        function (subKeypath) {
          watcher.addDep(subKeypath)
        }
      )
    }

    let { computed, reversedComputedKeys } = instance
    if (computed) {
      let target = computed[ keypath ]
      if (target) {
        return target.get()
      }
      let { name, prop } = matchBest(reversedComputedKeys, keypath)
      if (name && prop) {
        target = instance.computed[ name ].get()
        if (object.exists(target, prop)) {
          return target[ prop ]
        }
        else if (target != env.NULL) {
          result = object.get(target, prop)
          return result ? result.value : env.UNDEFINED
        }
      }
    }

    result = object.get(instance.data, keypath)

    return result ? result.value : defaultValue

  }

  /**
   * 更新数据
   *
   * @param {string|Object} keypath
   * @param {?*} value
   */
  set(keypath, value) {

    let instance = this

    let setValue = function (value, keypath) {

      keypath = keypathUtil.normalize(keypath)

      let newValue = value, oldValue = instance.get(keypath)

      if (newValue === oldValue) {
        return
      }

      let { emitter } = instance

      let getNewValue = function (key) {
        if (key === keypath || value == env.NULL) {
          return value
        }
        key = object.get(
          value,
          string.slice(
            key,
            keypathUtil.startsWith(key, keypath)
          )
        )
        if (key) {
          return key.value
        }
      }

      let fuzzyKeypaths = [ ]

      object.each(
        emitter.listeners,
        function (_, watchKey) {
          if (isFuzzyKeypath(watchKey)) {
            if (matchKeypath(keypath, watchKey)) {
              emitter.fire(watchKey, [ newValue, oldValue, keypath ])
            }
            else {
              array.push(fuzzyKeypaths, watchKey)
            }
          }
          else if (string.startsWith(watchKey, keypath)) {
            let watchNewValue = getNewValue(watchKey), watchOldValue = instance.get(watchKey)
            if (watchNewValue !== watchOldValue) {
              emitter.fire(watchKey, [ watchNewValue, watchOldValue, watchKey ])
            }
          }
        }
      )

      // 存在模糊匹配的需求
      // 必须对数据进行递归
      // 性能确实会慢一些，但是很好用啊，几乎可以监听所有的数据
      if (fuzzyKeypaths.length) {

        let addChange = function (newValue, oldValue, key) {
          if (newValue !== oldValue) {

            array.each(
              fuzzyKeypaths,
              function (fuzzyKeypath) {
                if (matchKeypath(key, fuzzyKeypath)) {
                  emitter.fire(fuzzyKeypath, [ newValue, oldValue, key ])
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
              let length = 'length'
              addChange(
                newIs ? newValue[ length ] : env.UNDEFINED,
                oldIs ? oldValue[ length ] : env.UNDEFINED,
                keypathUtil.join(key, length)
              )
            }
            else {
              newIs = is.object(newValue), oldIs = is.object(oldValue)
              if (newIs || oldIs) {
                diffObject(
                  newIs && newValue,
                  oldIs && oldValue,
                  function (newValue, oldValue, prop) {
                    addChange(
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
                    addChange(
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

        addChange(
          value,
          instance.get(keypath),
          keypath
        )

      }

      let { computed, reversedComputedKeys } = instance
      if (computed) {
        let target = computed[ keypath ]
        if (target && target.set) {
          target.set(value)
          return
        }
        let { name, prop } = matchBest(reversedComputedKeys, keypath)
        if (name && prop) {
          target = computed[ name ].get()
          if (!is.primitive(target)) {
            object.set(target, prop, value)
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

  }

  /**
   * 添加计算属性
   *
   * @param {string} keypath
   * @param {Function|Object} computed
   */
  addComputed(keypath, computed) {

    let instance = this, cache = env.TRUE, get, set, deps

    if (is.func(computed)) {
      get = computed
    }
    else if (is.object(computed)) {
      if (is.boolean(computed.cache)) {
        cache = computed.cache
      }
      if (is.func(computed.get)) {
        get = computed.get
      }
      if (is.func(computed.set)) {
        set = computed.set
      }
      if (computed.deps) {
        deps = computed.deps
      }
    }

    if (get || set) {

      let watcher = new Watcher(keypath, instance)

      if (get) {
        let hasDeps = is.array(deps) && deps.length > 0
        if (hasDeps) {
          array.each(
            deps,
            function (dep) {
              watcher.addDep(dep)
            }
          )
        }
        watcher.cache = cache
        watcher.getter = function () {
          if (cache) {
            if (hasDeps) {
              Observer.watcher = env.NULL
            }
            else {
              watcher.clearDep()
            }
          }
          return execute(get, instance.context)
        }
      }

      if (set) {
        watcher.set = function (value) {
          set.call(instance.context, value)
        }
      }

      let computed = instance.computed || (instance.computed = { })
      computed[ keypath ] = watcher

      instance.reversedComputedKeys = object.sort(computed, env.TRUE)

      return watcher

    }

  }

  /**
   * 取反 keypath 对应的数据
   *
   * 不管 keypath 对应的数据是什么类型，操作后都是布尔型
   *
   * @param {string} keypath
   * @return {boolean} 取反后的布尔值
   */
  toggle(keypath) {
    let value = !this.get(keypath)
    this.set(keypath, value)
    return value
  }

  /**
   * 递增 keypath 对应的数据
   *
   * 注意，最好是整型的加法，如果涉及浮点型，不保证计算正确
   *
   * @param {string} keypath 值必须能转型成数字，如果不能，则默认从 0 开始递增
   * @param {?number} step 步进值，默认是 1
   * @param {?number} min 可以递增到的最小值，默认不限制
   * @return {number} 返回递增后的值
   */
  increase(keypath, step, max) {
    let value = toNumber(this.get(keypath), 0) + (is.numeric(step) ? step : 1)
    if (!is.numeric(max) || value <= max) {
      this.set(keypath, value)
    }
    return value
  }

  /**
   * 递减 keypath 对应的数据
   *
   * 注意，最好是整型的减法，如果涉及浮点型，不保证计算正确
   *
   * @param {string} keypath 值必须能转型成数字，如果不能，则默认从 0 开始递减
   * @param {?number} step 步进值，默认是 1
   * @param {?number} min 可以递减到的最小值，默认不限制
   * @return {number} 返回递减后的值
   */
  decrease(keypath, step, min) {
    let value = toNumber(this.get(keypath), 0) - (is.numeric(step) ? step : 1)
    if (!is.numeric(min) || value >= min) {
      this.set(keypath, value)
    }
    return value
  }

  /**
   * 在数组指定位置插入元素
   *
   * @param {string} keypath
   * @param {*} item
   * @param {number} index
   * @return {?boolean} 是否插入成功
   */
  insert(keypath, item, index) {

    let list = this.get(keypath)
    if (!is.array(list)) {
      list = [ ]
    }
    else {
      list = object.copy(list)
    }

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
   * @param {string} keypath
   * @param {number} index
   * @return {?boolean} 是否移除成功
   */
  removeAt(keypath, index) {
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
   * @param {string} keypath
   * @param {*} item
   * @return {?boolean} 是否移除成功
   */
  remove(keypath, item) {
    let list = this.get(keypath)
    if (is.array(list)) {
      list = object.copy(list)
      if (array.remove(list, item)) {
        this.set(keypath, list)
        return env.TRUE
      }
    }
  }

  nextTick(fn) {
    nextTask.append(fn)
  }

  nextRun() {
    nextTask.run()
  }

  /**
   * 销毁
   */
  destroy() {
    this.emitter.off()
    object.clear(this)
  }

}

object.extend(
  Observer.prototype,
  {

    /**
     * 监听数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     * @param {?boolean} sync
     */
    watch: createWatch('on'),

    /**
     * 监听一次数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     * @param {?boolean} sync
     */
    watchOnce: createWatch('once'),

    /**
     * 取消监听数据变化
     *
     * @param {string|Object} keypath
     * @param {Function} watcher
     */
    unwatch: function (keypath, watcher) {
      let { emitter } = this
      if (is.string(keypath)) {
        emitter.off(keypath, watcher)
      }
      else if (is.object(keypath)) {
        object.each(
          keypath,
          function (watcher, keypath) {
            emitter.off(keypath, watcher)
          }
        )
      }
    }

  }
)

function createWatch(action) {

  let watch = function (instance, keypath, func, sync) {

    let { context } = instance

    instance.emitter[ action ](
      keypath,
      {
        func,
        context,
      }
    )

    if (sync) {
      execute(
        func,
        context,
        [ instance.get(keypath), env.UNDEFINED, keypath ]
      )
    }

  }

  return function (keypath, watcher, sync) {

    let instance = this

    if (is.string(keypath)) {
      watch(instance, keypath, watcher, sync)
    }
    else {
      if (watcher === env.TRUE) {
        sync = watcher
      }
      object.each(
        keypath,
        function (value, keypath) {
          let watcher = value, innerSync = sync
          if (is.object(value)) {
            watcher = value.watcher
            if (is.boolean(value.sync)) {
              innerSync = value.sync
            }
          }
          watch(instance, keypath, watcher, innerSync)
        }
      )
    }

  }

}
