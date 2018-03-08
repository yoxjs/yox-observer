
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as char from 'yox-common/util/char'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as string from 'yox-common/util/string'
import * as nextTask from 'yox-common/util/nextTask'
import * as keypathUtil from 'yox-common/util/keypath'

import isDef from 'yox-common/function/isDef'
import toNumber from 'yox-common/function/toNumber'
import execute from 'yox-common/function/execute'
import Emitter from 'yox-common/util/Emitter'

let guid = 0

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
    if (newObject) {
      keys = object.keys(
        object.extend({ }, oldObject, newObject)
      )
    }
    else {
      keys = object.keys(oldObject)
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

    let newLength = newArray ? newArray[ env.RAW_LENGTH ] : 0
    let oldLength = oldArray ? oldArray[ env.RAW_LENGTH ] : 0

    callback(
      newArray ? newLength : env.UNDEFINED,
      oldArray ? oldLength : env.UNDEFINED,
      env.RAW_LENGTH
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
 * @return {boolean}
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
  return cache.test(keypath)
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

export class Computed {

  constructor(keypath, observer) {

    let instance = this

    instance.id = ++guid
    instance.keypath = keypath
    instance.observer = observer
    instance.deps = [ ]

    instance.update = function (oldValue, key, globalChanges) {

      let value = instance.value, changes = instance.changes || (instance.changes = { })

      // 当前计算属性的依赖发生变化
      if (!object.has(changes, key)) {
        changes[ key ] = oldValue
      }

      // 把依赖和计算属性自身注册到下次可能的变化中
      observer.onChange(oldValue, key)
      // newValue 用不上，只是占位
      observer.onChange(value, keypath)

      // 当前计算属性是否是其他计算属性的依赖
      object.each(
        observer.computed,
        function (computed) {
          if (computed.hasDep(keypath)) {
            if (instance.get() !== value) {
              globalChanges.push(keypath, value, keypath)
              return env.FALSE
            }
          }
        }
      )

    }

  }

  get(force) {
    let { value, cache } = this
    if (cache === env.FALSE) {
      value = this.value = this.getter()
    }
    // 减少取值频率，尤其是处理复杂的计算规则
    else  if (force || this.isDirty()) {
      let lastComputed = Observer.computed
      Observer.computed = this
      value = this.value = this.getter()
      Observer.computed = lastComputed
      this.changes = env.NULL
    }
    return value
  }

  hasDep(dep) {
    return array.has(this.deps, dep)
  }

  addDep(dep) {
    if (!this.hasDep(dep)) {
      array.push(this.deps, dep)
      this.observer.watch(dep, this.update, env.FALSE, this)
    }
  }

  removeDep(dep) {
    if (this.hasDep(dep)) {
      array.remove(this.deps, dep)
      this.observer.unwatch(dep, this.update)
    }
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
    let { observer, changes } = this, result
    if (changes) {
      for (let key in changes) {
        if (changes[ key ] !== observer.get(key)) {
          return env.TRUE
        }
      }
    }
    // undefined 表示第一次执行，要返回 true
    return !isDef(changes)
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

    instance.data = options.data || { }
    instance.context = options.context || instance
    instance.emitter = new Emitter()
    instance.asyncEmitter = new Emitter()

    if (options.computed) {
      object.each(
        options.computed,
        function (item, keypath) {
          instance.addComputed(keypath, item)
        }
      )
    }

  }

  onChange(oldValue, keypath) {

    let instance = this, changes = string.startsWith(keypath, '$')
      ? (instance.$changes || (instance.$changes = { }))
      : (instance.changes || (instance.changes = { }))

    if (!object.has(changes, keypath)) {
      changes[ keypath ] = oldValue
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
                let args = [ newValue, oldValue, keypath ]
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
    if (keypath === char.CHAR_BLANK) {
      return instance.data
    }

    keypath = keypathUtil.normalize(keypath)

    // 调用 get 时，外面想要获取依赖必须设置是谁在收集依赖
    // 如果没设置，则跳过依赖收集
    if (Observer.computed) {
      Observer.computed.addDep(keypath)
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
        if (object.has(target, prop)) {
          return target[ prop ]
        }
        else if (target != env.NULL) {
          result = object.get(target, prop)
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
   * @param {string|Object} keypath
   * @param {?*} value
   */
  set(keypath, value) {

    let instance = this

    let { emitter } = instance

    let listenKeys = object.keys(emitter.listeners)

    let changes = [ ]

    let setValue = function (value, keypath) {

      keypath = keypathUtil.normalize(keypath)

      let newValue = value, oldValue = instance.get(keypath)

      if (newValue === oldValue) {
        return
      }

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

      array.each(
        listenKeys,
        function (listenKey) {
          if (isFuzzyKeypath(listenKey)) {
            if (matchKeypath(keypath, listenKey)) {
              changes.push(
                listenKey, oldValue, keypath
              )
            }
            else {
              array.push(fuzzyKeypaths, listenKey)
            }
          }
          else if (keypathUtil.startsWith(listenKey, keypath)) {
            let listenNewValue = getNewValue(listenKey), listenOldValue = instance.get(listenKey)
            if (listenNewValue !== listenOldValue) {
              changes.push(
                listenKey, listenOldValue, listenKey
              )
            }
          }
        }
      )

      // 存在模糊匹配的需求
      // 必须对数据进行递归
      // 性能确实会慢一些，但是很好用啊，几乎可以监听所有的数据
      if (fuzzyKeypaths[ env.RAW_LENGTH ]) {

        let addChange = function (newValue, oldValue, key) {
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
              addChange(
                newIs ? newValue[ env.RAW_LENGTH ] : env.UNDEFINED,
                oldIs ? oldValue[ env.RAW_LENGTH ] : env.UNDEFINED,
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

    for (let i = 0; i < changes[ env.RAW_LENGTH ]; i += 3) {
      emitter.fire(
        changes[ i ],
        [
          changes[ i + 1 ],
          changes[ i + 2 ],
          changes
        ]
      )
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

      let computed = new Computed(keypath, instance)

      if (get) {
        let hasDeps = is.array(deps) && deps[ env.RAW_LENGTH ] > 0
        if (hasDeps) {
          array.each(
            deps,
            function (dep) {
              computed.addDep(dep)
            }
          )
        }
        computed.cache = cache
        computed.getter = function () {
          if (cache) {
            if (hasDeps) {
              Observer.computed = env.NULL
            }
            else {
              computed.clearDep()
            }
          }
          return execute(get, instance.context)
        }
      }

      if (set) {
        computed.set = function (value) {
          set.call(instance.context, value)
        }
      }

      if (!instance.computed) {
        instance.computed = { }
      }

      instance.computed[ keypath ] = computed

      instance.reversedComputedKeys = object.sort(instance.computed, env.TRUE)

      return computed

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

    let length = list[ env.RAW_LENGTH ]
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
      && index < list[ env.RAW_LENGTH ]
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
    this.asyncEmitter.off()
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
      let { emitter, asyncEmitter } = this
      if (is.string(keypath)) {
        emitter.off(keypath, watcher)
        asyncEmitter.off(keypath, watcher)
      }
      else if (is.object(keypath)) {
        object.each(
          keypath,
          function (watcher, keypath) {
            emitter.off(keypath, watcher)
            asyncEmitter.off(keypath, watcher)
          }
        )
      }
    }

  }
)

function createWatch(action) {

  let watch = function (instance, keypath, func, sync, computed) {

    let { context } = instance

    instance.emitter[ action ](
      keypath,
      {
        func: computed ? func : instance.onChange,
        context: computed ? computed : instance,
      }
    )

    if (!computed) {
      instance.asyncEmitter[ action ](
        keypath,
        {
          func,
          context,
        }
      )
    }

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

  return function (keypath, watcher, sync, computed) {

    let instance = this

    if (is.string(keypath)) {
      watch(instance, keypath, watcher, sync, computed)
    }
    else {
      if (watcher === env.TRUE) {
        sync = watcher
      }
      object.each(
        keypath,
        function (value, keypath) {
          let watcher = value, itemSync = sync
          if (is.object(value)) {
            watcher = value.watcher
            if (is.boolean(value.sync)) {
              itemSync = value.sync
            }
          }
          watch(instance, keypath, watcher, itemSync, computed)
        }
      )
    }

  }

}
