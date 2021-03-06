
import Observer from 'yox-observer/src/Observer';

test('watch immediate or not', () => {

  let count1 = 0, count2 = 0, count3 = 0, count4 = 0, count5 = 0, count6 = 0

  let observer = new Observer({ })

  observer.watch(
    'name1',
    function () {
      count1 = 1
    }
  )

  observer.watch(
    'name2',
    function () {
      count2 = 1
    },
    true
  )

  observer.watch({
    name3: {
      watcher: function () {
        count3 = 1
      }
    }
  })

  observer.watch({
    name4: {
      immediate: false,
      watcher: function () {
        count4 = 1
      }
    },
    name5: {
      immediate: true,
      watcher: function () {
        count5 = 1
      }
    },
    name6: {
      immediate: false,
      watcher: function () {
        count6 = 1
      }
    },
  })

  expect(count1).toBe(0)
  expect(count2).toBe(1)
  expect(count3).toBe(0)
  expect(count4).toBe(0)
  expect(count5).toBe(1)
  expect(count6).toBe(0)

})

test('watch sync', done => {

  let observer = new Observer()

  let count1 = 0, count2 = 0, count3 = 0

  observer.watch(
    'name',
    {
      watcher: function () {
        expect(arguments.length).toBe(3)
        count1++
      },
      sync: true
    }
  )

  observer.watch(
    'name',
    function () {
      expect(arguments.length).toBe(3)
      count2++
    }
  )

  observer.set('name', 1)

  // 不应该触发这个最新的监听
  observer.watch(
    'name',
    function () {
      count3++
    }
  )

  expect(count1).toBe(1)
  expect(count2).toBe(0)
  expect(count3).toBe(0)

  observer.nextTask.append(function () {
    expect(count1).toBe(1)
    expect(count2).toBe(1)
    expect(count3).toBe(0)
    done()
  })

})

test('watch once', done => {

  let observer = new Observer({ })

  let count = 0

  observer.watch(
    'name',
    {
      watcher: function () {
        count++
      },
      once: true
    }
  )

  observer.set('name', 1)

  expect(count).toBe(0)

  observer.nextTask.append(function () {
    expect(count).toBe(1)

    observer.set('name', 2)

    expect(count).toBe(1)
    observer.nextTask.append(function () {
      expect(count).toBe(1)
      done()
    })

  })

})


test('unwatch', done => {

  let observer = new Observer({ })

  let count = 0
  let watcher = function () {
    count++
  }

  observer.watch('name', watcher)
  observer.set('name', 1)

  expect(count).toBe(0)
  observer.unwatch('name', watcher)

  observer.nextTask.append(function () {
    expect(count).toBe(0)
    done()
  })

})

test('get default value', () => {

  let observer = new Observer()

  expect(observer.get('count', 100)).toBe(100)

})

test('increase', () => {

  let observer = new Observer()

  expect(observer.increase('count')).toBe(1)
  expect(observer.get('count')).toBe(1)

  expect(observer.increase('count', 2)).toBe(3)
  expect(observer.get('count')).toBe(3)

  expect(observer.increase('count', 2, 3)).toBe(undefined)
  expect(observer.get('count')).toBe(3)

})

test('decrease', () => {

  let observer = new Observer()

  expect(observer.decrease('count')).toBe(-1)
  expect(observer.get('count')).toBe(-1)

  expect(observer.decrease('count', 2)).toBe(-3)
  expect(observer.get('count')).toBe(-3)

  expect(observer.decrease('count', 2, -3)).toBe(undefined)
  expect(observer.get('count')).toBe(-3)

})

test('toggle', () => {

  let observer = new Observer()

  expect(observer.toggle('disabled')).toBe(true)
  expect(observer.get('disabled')).toBe(true)

  expect(observer.toggle('disabled')).toBe(false)
  expect(observer.get('disabled')).toBe(false)

})

test('simple undo', done => {

  let observer = new Observer({
    name: 1
  })

  let count = 0
  let watcher = function () {
    count++
  }

  observer.watch('name', watcher)
  observer.set('name', 2)
  observer.set('name', 1)

  expect(count).toBe(0)

  observer.nextTask.append(function () {
    expect(count).toBe(0)
    done()
  })

})

test('complex undo', done => {

  let observer = new Observer(
    {
      a: 1,
      b: 2,
    }
  )

  observer.addComputed(
    'sum',
    function () {
      return this.get('a') + this.get('b')
    }
  )

  let count = 0
  let watcher = function () {
    count++
  }

  expect(observer.get('sum')).toBe(3)

  observer.watch('sum', watcher)
  observer.set('a', 2)
  observer.set('b', 3)

  expect(observer.get('sum')).toBe(5)
  expect(count).toBe(0)

  observer.set('a', 1)
  observer.set('b', 2)

  observer.nextTask.append(function () {
    expect(observer.get('sum')).toBe(3)
    expect(count).toBe(0)
    done()
  })

})

test('change computed data', done => {

  let call1 = 0, call2 = 0
  let observer = new Observer(
    {
      a: 1,
      b: 2,
    }
  )

  observer.addComputed(
    'sum1',
    function () {
      call1++
      return this.get('a') + this.get('b')
    }
  )

  observer.addComputed(
    'sum2',
    {
      sync: false,
      get: function () {
        call2++
        return this.get('a') + this.get('b')
      }
    }
  )

  expect(observer.get('sum1')).toBe(3)
  expect(observer.get('sum2')).toBe(3)

  let sum1 = 0, count = 0
  observer.watch('sum1', function (value) {
    count++
    sum1 = value
  })

  expect(call1).toBe(1)
  expect(call2).toBe(1)

  observer.set('a', 2)
  observer.set('b', 3)

  expect(call1).toBe(3)
  expect(call2).toBe(1)

  expect(sum1).toBe(0)
  expect(count).toBe(0)
  expect(observer.get('sum1')).toBe(5)

  observer.nextTask.append(function () {
    expect(call1).toBe(3)
    expect(call2).toBe(2)
    expect(sum1).toBe(5)
    expect(count).toBe(1)
    done()
  })

})

test('change computed fuzzy data', done => {

  let observer = new Observer(
    {
      user: {
        age1: 1,
        age2: 2,
      }
    }
  )

  observer.addComputed(
    'sum',
    {
      deps: ['user.*'],
      get: function () {
        return this.get('user.age1') + this.get('user.age2')
      }
    }
  )

  expect(observer.get('sum')).toBe(3)

  let sum = 0, count = 0
  observer.watch('sum', function (value) {
    count++
    sum = value
  })

  observer.set('user.age1', 2)
  observer.set('user.age2', 3)

  expect(sum).toBe(0)
  expect(count).toBe(0)
  expect(observer.get('sum')).toBe(5)

  observer.nextTask.append(function () {
    expect(sum).toBe(5)
    expect(count).toBe(1)
    done()
  })

})

test('watch object property', done => {

  let observer = new Observer({
    user: {
      name: 'yox',
      age: 1
    }
  })

  let count1 = 0
  let watcher1 = function () {
    count1++
  }

  let count2 = 0
  let watcher2 = function () {
    count2++
  }

  observer.watch('user.name', watcher1)
  observer.watch('user.*', watcher2)
  observer.set('user.name', 'yox1')

  observer.nextTask.append(function () {
    expect(count1).toBe(1)
    expect(count2).toBe(1)

    observer.set('user', {
      name: 'yox2',
      age: 2
    })

    observer.nextTask.append(function () {
      expect(count1).toBe(2)
      expect(count2).toBe(3)
      done()
    })

  })

})

test('simple dependency', done => {

  let observer = new Observer(
    {
      list: [
        { id: 1, selected: true },
        { id: 2, selected: false },
        { id: 3, selected: true },
        { id: 4, selected: false },
      ]
    }
  )

  observer.addComputed(
    'selectedList',
    {
      deps: ['list', 'list.*.selected'],
      get: function () {
        return this.get('list').filter(item => {
          return item.selected
        })
      }
    }
  )

  let count1 = 0, count2 = 0, selected1New, selected1Old

  observer.watch('list.0.selected', function (newValue, oldValue) {
    count1++
    selected1New = newValue
    selected1Old = oldValue
  })
  observer.watch('selectedList', function (newValue, oldValue) {
    count2++
  })


  let selectedList = observer.get('selectedList')
  expect(selectedList).toBe(observer.get('selectedList'))

  observer.set('list.0.selected', false)

  observer.nextTask.append(() => {


    expect(count1).toBe(1)
    expect(selected1New).toBe(false)
    expect(selected1Old).toBe(true)
    expect(count2).toBe(1)

    observer.set('list.0.selected', false)

    observer.nextTask.append(() => {

      expect(count1).toBe(1)
      expect(selected1New).toBe(false)
      expect(selected1Old).toBe(true)
      expect(count2).toBe(1)

      observer.set('list.0.selected', true)

      observer.nextTask.append(() => {

        expect(count1).toBe(2)
        expect(selected1New).toBe(true)
        expect(selected1Old).toBe(false)
        expect(count2).toBe(2)

        observer.set('list', [
          { id: 1, selected: false },
          { id: 2, selected: false },
          { id: 3, selected: false },
          { id: 4, selected: false },
        ])

        observer.nextTask.append(() => {
          expect(count1).toBe(3)
          expect(selected1New).toBe(false)
          expect(selected1Old).toBe(true)
          expect(count2).toBe(3)
          done()
        })


      })



    })



  })


})


test('complex dependency', done => {

  let observer = new Observer(
    {
      list: [
        { id: 1, selected: true },
        { id: 2, selected: true },
        { id: 3, selected: true },
        { id: 4, selected: true },
      ]
    }
  )

  observer.addComputed(
    'selectedList',
    {
      deps: ['list', 'list.*.selected'],
      get: function () {
        return this.get('list').filter(item => {
          return item.selected
        })
      }
    }
  )

  observer.addComputed(
    'sortedSelectedList',
    {
      deps: ['selectedList'],
      get: function () {
        return this.get('selectedList').sort((a, b) => {
          return a.id - b.id
        })
      }
    }
  )

  let list0Count = 0, list0SelectedNew: any, list0SelectedOld: any
  observer.watch('list.0.selected', function (newValue, oldValue) {
    list0Count++
    list0SelectedNew = newValue
    list0SelectedOld = oldValue
  })
  let list1Count = 0, list1SelectedNew: any, list1SelectedOld: any
  observer.watch('list.1.selected', function (newValue, oldValue) {
    list1Count++
    list1SelectedNew = newValue
    list1SelectedOld = oldValue
  })

  let selectedListCount = 0, selectedListNew: any, selectedListOld: any
  observer.watch('selectedList', function (newValue, oldValue) {
    selectedListCount++
    selectedListNew = newValue
    selectedListOld = oldValue
  })
  let sortedSelectedListCount = 0, sortedSelectedListNew: any, sortedSelectedListOld: any
  observer.watch('sortedSelectedList', function (newValue, oldValue) {
    sortedSelectedListCount++
    sortedSelectedListNew = newValue
    sortedSelectedListOld = oldValue
  })

  observer.set('list.0.selected', false)
  observer.nextTask.append(() => {
    expect(list0Count).toBe(1)
    expect(list0SelectedNew).toBe(false)
    expect(list0SelectedOld).toBe(true)

    expect(selectedListCount).toBe(1)
    expect(Array.isArray(selectedListNew)).toBe(true)
    expect(Array.isArray(selectedListOld)).toBe(false)
    expect(selectedListNew).not.toBe(selectedListOld)

    expect(sortedSelectedListCount).toBe(1)
    expect(Array.isArray(sortedSelectedListNew)).toBe(true)
    expect(Array.isArray(sortedSelectedListOld)).toBe(false)
    expect(sortedSelectedListNew).not.toBe(sortedSelectedListOld)
    done()
  })

  // ts 会报以下变量没用过，那就在这用下咯，不然怎么办...
  list0Count
  list0SelectedNew
  list0SelectedOld

  list1Count
  list1SelectedNew
  list1SelectedOld

  selectedListCount
  selectedListNew
  selectedListOld

  sortedSelectedListCount
  sortedSelectedListNew
  sortedSelectedListOld


})
