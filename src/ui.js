(function(window, undefined) {
var
    space = String.fromCharCode(160),
    defaultParams = {
        input: '.surt__input',
        suggest: '.surt__suggests',
        suggestItemCls: 'surt__suggests-item',
        aunt: 99
    };

    function spaces(text) {
        var re = new RegExp(space, "g"); // Заменяем неразрывные пробелы на пробел

        return text.replace(re, " ");
    }

    function kitsAreEqual(kit1, kit2) {
        var result = true;

        kit1 = kit1 || [];
        kit2 = kit2 || [];

        if (!kit1.length || !kit2.length) return !(kit1.length || kit2.length);

        if (kit1.length != kit2.length) return;

        for (var i = 0 ; i < kit1.length ; i++) {
            result = result && (kit1[i].text == kit2[i].text) && (kit1[i].type == kit2[i].type);
        }

        return result && (kit1.length == kit2.length);
    }

    var surt = function(params) {
        var ret;

        params = params || {};

        for (var key in defaultParams) {
            if (!params[key]) {
                params[key] = defaultParams[key];
            }
        }

        params.root = this[0];

        function validateNode(node, name) {
            if (!(node && node.nodeType == 1)) {
                throw new Error('Surt: html element ' + name + ' not found or it has wrong nodeType');
            }
        }

        params.root = $(params.root)[0];

        validateNode(params.root, 'params.root');
        if (params.input) {
            params.input = $(params.input, params.root)[0];
        }
        if (!params.input) {
            params.input = $('[contenteditable="true"]', params.root);
        }
        validateNode(params.input, 'params.input');

        if ($(params.root).attr('data-surt-inited') == 'true') {
            throw new Error('Surt: already initialized');
        }

        ret = new surt.fn.constructor(params);

        return ret;
    };

    surt.fn = {
        // Создает объект surt
        constructor: function(params) {
            var self = this,
                root = params.root;

            params = params || {};
            this.params = params;
            // this.parser = surt.parser;
            this.inputNode = $(params.input, root)[0];
            this.root = $(params.root, root)[0];
            this.suggestNode = $(params.suggest, root)[0];
            this.cloneNode = $(params.clone, root)[0];
            this.hintNode = $(params.hint, root)[0];
            this.delimiter = params.delimiter || ''; // Разделитель токенов, между правой границей токена и следующим за ним пробелом
            this.placeholder = params.placeholder || '';
            this._submitEvents = params.events || ['enter'];
            this._pressedKeys = 0;
            this._time = new Date().getTime();
            this._events = {};

            this.kit = [];

            this._activeSuggest = -1;

            // К этому месту считаем, что инициализация прошла успешно
            $(this.root).attr('data-surt-inited', true);

            function resetTimer() {
                clearTimeout(self._upTimer);
                self._upTimer = setTimeout(function() {
                    self._pressedKeys = 0;
                }, 300);
            }

            // Выбрать сагест и принудительно затолкать его в инпут
            // submit true если синхронно за выбором следует сабмит
            function pickSuggest(submit, e) {
                var data = self.args(),
                    suggest = self.params.selectionCls ? data.suggest : undefined; // Насильно обновляем сагест если могло поменяться выделение selectionCls

                data.kit = self.suggest[self._activeSuggest];

                self.set({
                    kit: data.kit,
                    suggest: suggest
                }, true);

                if (params.pick) params.pick(data.kit, submit, e);

                self.markSuggest(-1); // Снимаем выделение с сагестов

                self.scroll();
            }

            // Если нажата клавиша, меняющая текст - возвращает true
            function affectsToValue(key) {
                return key == 8 ||                  // backspace
                    key == 32 ||                    // пробел
                    key == 46 ||                    // delete
                    key > 47 && key < 91 ||         // числа, буквы, символы
                    key > 95 && key < 112 ||        // numpad
                    key > 159 && key < 177 ||
                    key > 187 && key < 193 ||
                    key > 218 && key < 223 ||
                    key > 256;
            }

            // Если нажата не буква - возвращает true
            function isControlKey(key) {
                // Left, Right, Shift, Left Ctrl, Right Ctrl, Cmd, End, Home, Enter, Backspace, Delete
                return key == 37 || key == 39 ||
                    key == 16 || key == 17 ||
                    key == 18 || key == 91 ||
                    key == 35 || key == 36 ||
                    key == 13 || key == 8 ||
                    key == 46;
            }

            this.updateHint();

            // Навешиваем все необходимые события
            $(this.inputNode)
                .on('keyup.surt', function(e){
                    var key = e.keyCode,
                        data;

                    if (key == 27) { // Esc
                        e.stopPropagation();
                        return;
                    };

                    self._pressedKeys--;
                    if (self._pressedKeys < 0) self._pressedKeys = 0;

                    if ((key == 40 || key == 38) && $(self.root).hasClass(params.suggestCls) ) {
                        return;
                    }

                    if (key == 229) {
                        // IME charcode: мобильные браузеры не умеют передавать оригинальные коды.
                        // Так что берем последний символ, щито поделать.
                        key = self.text().charCodeAt(self.text().length - 1);
                        if (key != key) { // если нету, тут будет NaN, отлавливаем.
                            return;
                        }
                    }

                    // Если есть активный автокомплит, при дальнейшем наборе его нужно сначала подставить
                    // Используем isControlKey вместо affectsToValue, так как клавиши delete и backspace
                    // не должны влиять на выбор элемента из саггеста
                    if (self.suggest && self.suggest[self._activeSuggest] && !isControlKey(key)) {
                        pickSuggest(false, e);
                    }

                    self.updateInput();
                    self.updateHint();

                    data = self.args();

                    if (params.change && affectsToValue(key)) {
                        params.change(e, data);
                    }
                })
                .on('keydown.surt input.surt paste.surt', function(e) { // input paste
                    var key = e.keyCode,
                        index,
                        data;

                    // Прочие буквы
                    if ( e.type == 'keydown' && affectsToValue(key) ) { // При нажатии на символ
                        self._pressedKeys++;
                        resetTimer();
                    }

                    // Для контрол-клавиш блокировки быть не должно
                    // Дополнительно учитывается случай, когда событие инициировано из кода (e.keyCode = undefined)
                    if (key && !affectsToValue(key)) {
                        self._pressedKeys = 0;
                    } else {
                        $(self.root).removeClass(self.params.placeholderCls);
                    }

                    // Enter
                    if (key == 13) {
                        e.preventDefault();
                        var submit = true;
                        if (self.isIncompleteQuery()) {
                            submit = false;
                        }

                        var suggestPicked = $(self.root).hasClass(params.suggestCls) && $(self.root).find('.' + params.suggestItemCurrentCls).length;
                        if (suggestPicked) {
                            pickSuggest(submit, e);
                        }

                        // Стандартный сабмит по ентеру
                        if (submit && self.params.submit && $.inArray('enter', self._submitEvents) != -1) {
                            self.params.submit(e, suggestPicked);

                            // Удаляем сагесты и автокомплит
                            $(self.root).removeClass(params.suggestCls);
                            $(self.root).removeClass(params.autocompleteCls);
                        }

                        self.markSuggest(-1); // Снятие выделения с сагеста

                        return false;
                    }

                    // Стрелка вниз
                    if (key == 40) {
                        index = 0;

                        if (self._activeSuggest >= 0 && self.suggest) {
                            index = self._activeSuggest < self.suggest.length - 1 ? self._activeSuggest + 1 : 0;
                        }

                        self.markSuggest(index);

                        return false;
                    }

                    // Стрелка вверх
                    if (key == 38) {
                        index = self.suggest && self.suggest.length - 1;

                        if (self._activeSuggest >= 0 && self.suggest) {
                            index = self._activeSuggest > 0 ? self._activeSuggest - 1 : self.suggest.length - 1;
                        }

                        self.markSuggest(index);

                        return false;
                    }

                    // Стрелка вправо
                    if (key == 39) {
                        var length = self.text().length;

                        // Если курсор в крайне правом положении, делаем сет с новыми данными (довершаем автокомплит)
                        if (self.getCursor() >= length && self.suggest) {
                            var autocompleteActive = $(self.root).hasClass(self.params.autocompleteCls) || self._activeSuggest != -1,
                                active = (self._activeSuggest == -1) ? 0 : self._activeSuggest;

                            if (autocompleteActive) { // Автокомплит есть и его надо подставить
                                data = self.args();
                                data.kit = self.suggest[active];
                                self.set(data, true);
                                // Сабмит на заполнении автокомплита
                                if (self.params.submit && $.inArray('auto', self._submitEvents) != -1) {
                                    self.params.submit(e, true);
                                }
                                if (self.suggest && self.suggest.length && self.params.complete) { // Для статистики
                                    self.params.complete();
                                }
                            }
                        }
                    }

                    // Esc
                    if (key == 27) {
                        $(self.root).removeClass(self.params.suggestCls);
                        e.preventDefault(); /* f opera 12 */
                    }
                })
                .on('paste.surt', function() {
                    setTimeout(function(){
                        self.parse();
                    }, 0);
                })
                .on('focus.surt click.surt', function() {
                    var noBefore = !$(self.root).hasClass(self.params.suggestCls);

                    $(self.root).addClass(self.params.stateFocusCls);
                    if (self.suggest && self.suggest.length) {
                        $(self.root).addClass(self.params.suggestCls);
                    }
                    self.updateHint();

                    if (noBefore) { // Произошла именно инверсия показа сагеста, а не очередной показ
                        if (self.params.show) {
                            self.params.show(self._suggestExist);
                        }
                    }
                })
                .on('blur.surt', function() {
                    $(self.root).removeClass(self.params.stateFocusCls);
                    $(self.root).removeClass(self.params.readyCls);
                    $(self.root).removeClass(self.params.autocompleteCls);
                    $(self.root).removeClass(self.params.suggestCls);
                });

            // this._events.mousemove = function(e) {
            //     var suggestsItems = $('.' + params.suggestItemCls),
            //         index = suggestsItems.index( $(this) );

            //     self.markSuggest(index);
            // };

            $(this.root)
                .on('mousedown.surt', '.' + self.params.suggestItemCls, function(e) {
                    var suggestsItems = $('.' + params.suggestItemCls),
                        index = suggestsItems.index( $(this) );

                    if (!self.suggest || !self.suggest[index]) return; // html illegal append situation

                    self._activeSuggest = index;

                    var willSubmit = $.inArray('click', self._submitEvents) != -1 && !self.isIncompleteQuery();

                    pickSuggest(willSubmit, e);
                    if (self.params.submit && willSubmit) { // Если пользователь хочет, то клик по сагесту приведёт к поиску, и обновлять сагест уже не надо
                        self.params.submit(e, true);
                    } else if (self.params.change) { // Иначе - стандартное обновление сагеста
                        self.params.change(e, self.args());
                    }

                    if (!$(e.target).closest(self.params.suggestItemCls).length) {
                        $(self.root).removeClass(self.params.suggestCls).removeClass(self.params.autocompleteCls);
                    }
                }); // Почему не клик??
                // .on('mousemove', '.' + self.params.suggestItemCls, self._events.mousemove);
        },

        // true если новый кит по смыслу отличается от текущего
        semanticChanged: function(kit) {
            return !kitsAreEqual(kit, this.kit);
        },

        // Возвращает текущий кит
        get: function() {
            return this.kit;
        },

        // Устанавливает новые данные (set - единственная точка входа на новые данные ORLY)
        set: function(data, force) {
            data = data || {};

            if (this._pressedKeys > 0) return; // Если на момент входа в функцию пользователь уже нажал новую клавишу - сетить бессмысленно

            if (data.kit && data.kit.length === undefined) { // not an array
                data.kit = [data.kit];
            }

            this.saveCursor();

            var same = kitsAreEqual(data.kit, this.kit);

            if (data.kit) this.kit = data.kit;
            if (!same || force) this.updateKit(force);

            if (data.suggest) {
                this.suggest = data.suggest;
                this.updateSuggest();
            }

            this.updateHint();

            this.restoreCursor();
        },

        // Устанавливает только данные поисоковй строки
        setKit: function(kit) {
            // if (kitsAreEqual(kit, this.kit)) return;

            this.kit = kit;
            this.updateKit();
        },

        // Обновляет UI
        update: function() {
            this.updateKit();
            this.updateSuggest();
            this.updateHint();
        },

        // Обновляет инпут по смыслам, включая хвост
        updateInput: function() {
            var parsedKit = this.parse(),
                newKit = this.brick(parsedKit),
                tail = this.getTail(newKit); // Возвращает нетокенные ошметки, типа ", "

            if (this.semanticChanged(newKit) || tail) {
                this.setKit(newKit);

                if (tail && this.params.inputMode != 'text') {
                    $(this.inputNode).append(tail.replace(' ', '&nbsp;'));
                    this.restoreCursor(999);
                }
            }
        },

        // Обновляет html в инпуте
        // force - обновляет код в инпуте в любом случае
        updateKit: function(force) {
            var inputHTML = [],
                tokenCls = this.params.tokenCls,
                textCls = this.params.textCls || tokenCls,
                left = '',
                right = '';

            if (this.kit) {
                this.saveCursor();

                for (var i = 0 ; i < this.kit.length ; i++) {
                    var html = this.trim(this.kit[i].text); /* f ie8 */

                    if (!this.textMode()) {
                        if (this.kit[i].type == "text" && textCls) {
                            left = '<div class="' + textCls + '">';
                            right = '</div>';
                        } else if (tokenCls) {
                            left = '<div class="' + tokenCls + ' ' + '_type_' + this.kit[i].type + '">';
                            right = '</div>';
                        }
                        html = left + html + right;
                    }
                    // После всех токенов, кроме крайне правого, выставлять разделитель (если он есть)
                    // if (i != this.kit.length - 1) {
                    //     html += this.delimiter;
                    // }

                    inputHTML.push(html);
                }

                inputHTML = inputHTML.join(this.delimiter + ' ');

                if (this.isIncompleteQuery() && inputHTML[inputHTML.length - 1] != ' ') {
                    inputHTML += ' ';
                }

                // if (this.trailingSpace) inputHTML += space;
                if (this.params.inputMode != 'text' || force) {
                    this.html(inputHTML);
                    this.restoreCursor();
                }
            }
        },

        // Обновляет HTML в выпадашке сагестов
        updateSuggest: function() {
            var suggestHTML = [],
                tokenCls = this.params.tokenCls,
                textCls = this.params.textCls || tokenCls,
                count,
                beforeState = !this._suggestExist;

            this._suggestExist = !!(this.suggest && this.suggest.length);
            if (this.suggest) {
                var inversed = !(beforeState ^ this._suggestExist);

                if (inversed && this.params.show) { // Произошла именно инверсия показа сагеста, а не очередной показ
                    this.params.show(this._suggestExist);
                }

                for (var i = 0 ; i < this.suggest.length ; i++) {
                    var kit = [];

                    for (var j = 0 ; j < this.suggest[i].length ; j++) {
                        var html = this.suggest[i][j].html || this.suggest[i][j].text;

                        html = this.trim(html); /* f ie8 */

                        if (this.params.selectionCls) {
                            html = this.parser.replace.call(this, html);
                            // html = html.replace(new RegExp(espape(this.text()), "i"), '<span class="' + this.params.selectionCls + '">$&</span>');
                        }

                        if ( this.suggest[i][j].type != 'text' ) {
                            if (tokenCls) {
                                html = '<div class="' + tokenCls + ' ' + '_type_' + this.suggest[i][j].type + '">' + html + '</div>';
                            }

                            kit.push(html);
                        } else {
                            if (textCls) {
                                html = '<div class="' + textCls + '">' + html + '</div>';
                            }

                            kit.push(html);
                        }
                    }

                    count = kit.length;
                    kit = kit.join(this.delimiter + ' ');
                    var countMod = '';
                    if (this.params.suggestItemCountCls) {
                        countMod = ' ' + this.params.suggestItemCountCls + count;
                    }
                    suggestHTML.push('<li class="' + this.params.suggestItemCls + countMod + '">' + kit + '</li>');
                    this._activeSuggest = -1;
                }
                count = suggestHTML.length;
                suggestHTML = suggestHTML.join('');
                if (this.suggestNode) {
                    if (suggestHTML) $(this.root).addClass(this.params.suggestCls);
                    else $(this.root).removeClass(this.params.suggestCls);
                    this.suggestNode.innerHTML = suggestHTML;
                }

                // Проверяем ширину сагестов и выставляем модификатор тем, которые шири
                // var suggestWidth = this.suggestNode.clientWidth,
                //     kits = $('.' + this.params.suggestItemCls, this.suggestNode);

                // for (i = 0 ; i < count ; i++) {
                //     if (kits[i].offsetWidth > suggestWidth && this.suggest[i].length > 1 && this.params.suggestItemOverflowedCls) {
                //         $(kits[i]).addClass(this.params.suggestItemOverflowedCls);
                //     }
                // }
            }
        },

        updateHint: function() {
            this.updateAutocomplete();

            if (!this.text()) {
                $(this.root)
                    .addClass(this.params.placeholderCls)
                    .removeClass(this.params.autocompleteCls);
                this.updatePlaceholder();
            }
        },

        // Обновляет html в подсказке как автокомплит
        updateAutocomplete: function() {
            var active = this._activeSuggest == -1 ? 0 : this._activeSuggest, // Индекс текущего сагеста
                su = this.suggest && this.suggest.length && this.suggest[active], // Текущий сагест
                text = this.text(),
                self = this;

            if (!this.hintNode) return;

            $(this.root).removeClass(this.params.placeholderCls);

            // Автокомплит
            if (this.kit && this.kit.length && this.cloneNode) {
                if (su && su.length) { // Сагест есть, его надо затолкать в автокомплит
                    var lastKitText = this.kit[this.kit.length - 1].text, // Неполный токен, который надо сагестировать
                        kitPos = 0, //= this.kit.length - 1, // Номер крайнего токена, который будет при вводе следующего символа
                        suggestText, // Результат преобразования текущего сагеста в текст, как если бы он был в инпуте и мы взяли бы text()
                        isAutocomplete; // Текст в строке пока совпадает с сагестом, и имеет смысл его автокомплитить

                    // if (this.trailingSpace) { // На левой границе второго (нового) токена - то есть первый уже окуклился, и выводить комплит на первый токен сагеста уже не надо
                    //     kitPos++;
                    // }
                    // Преобразуем текущий сагест в текст
                    suggestText = [];
                    if (this.suggest[0].length > kitPos) {
                        for (var i = kitPos ; i < this.suggest[active].length ; i++) {
                            suggestText.push(this.suggest[active][i].text);
                        }
                    }
                    suggestText = suggestText.join(this.delimiter + ' ');
                    if (suggestText == text) { // Автокомплит полностью набран, пора нажимать ентер
                        $(this.root).addClass(this.params.readyCls);
                    } else {
                        isAutocomplete = suggestText.toLowerCase().indexOf(text.toLowerCase()) == 0;
                        $(this.root).removeClass(this.params.readyCls);
                    }

                    if (this._activeSuggest != -1) {
                        this.hintNode.innerHTML = suggestText.slice(text.length);
                    } else {
                        this.hintNode.innerHTML = '';
                    }
                    this.cloneNode.innerHTML = this.html();
                    if ($(this.root).hasClass(this.params.suggestCls) && isAutocomplete && suggestText.length < this.params.aunt) {
                        $(this.root).addClass(this.params.autocompleteCls);
                    } else { // Сагесты свернуты, либо текущий не является автокомплитом
                        rmAutocomplete();
                    }
                } else { // Сагестов нет вообще, удаляем текст из автокомплита
                    rmAutocomplete();
                }
            } else { // Кита нет, либо текста нет - автокомплит не нужен
                rmAutocomplete();
            }

            function rmAutocomplete() {
                $(self.hintNode).html('');
                $(self.cloneNode).html('');
                $(self.root).removeClass(self.params.autocompleteCls);
            }
        },

        // Обновляет html в подсказке как плейсхолдер
        updatePlaceholder: function(text) {
            this.placeholder = text || this.placeholder;

            if (!this.text()) {
                $(this.hintNode).html(this.placeholder);
            }
        },

        // Возвращает текст из поисковой строки
        query: function(kit) {
            var text = '';
            kit = kit || this.kit;

            for (var i = 0 ; i < kit.length ; i++) {
                if (i > 0) text += ' ';
                text += kit[i].text;
            }

            return spaces(text);
        },

        isIncompleteQuery: function() {
            // Если саггест один, в любом случае не считаем его "неполным",
            // т.к. юзер может получить неприятное поведение — выбрал неполный саггест,
            // сабмита не произошло, а кроме этого саггеста других нет, придётся руками сабмитить.
            if (this.suggest && this.suggest.length == 1) {
                return false;
            }
            if (!this.suggest ||
                !this.suggest[this._activeSuggest] ||
                !this.suggest[this._activeSuggest][0] ||
                !this.suggest[this._activeSuggest][0].item) {
                return false;
            }

            var hintText = this.suggest[this._activeSuggest][0].item.hint.text;
            var inputText = this.inputNode.value;

            if (hintText.trim() == inputText.trim()) {
                // Если из саггеста выбирается ровно (с точностью до пробелов по краям) тот же текст,
                // что уже набран в инпуте, не считаем саггест "неполным", т.к.
                // с точки зрения юзера ничего не произойдёт и будет похоже на баг.
                return false;
            }

            return this.suggest[this._activeSuggest][0].item.hint.incomplete_query;
        },

        // Возвращает или устанавливает текст в инпут
        text: function(text) {
            if (!text) {
                return spaces($(this.inputNode).text() || $(this.inputNode).val());
            } else {
                this.html(text);
            }
        },

        // Возвращает или устанавливает html в инпут
        html: function(html) {
            var input = $(this.inputNode);

            if (!html) {
                return input.html() || this.text();
            } else {
                if (this.inputNode.tagName == 'INPUT') {
                    input.val(html);
                } else {
                    input.html(html);
                }
                this.scroll();
            }
        },

        // Переводит текст в крайне правое положение, чтоб было видно конец строки текста
        scroll: function() {
            this.inputNode.scrollLeft = this.inputNode.scrollWidth; // pseudo Infinity, which does not supported by Chrome
        },

        // Возвращает текущую версию с данными
        args: function() {
            var data = {};

            data.kit = this.kit;
            data.suggest = this.suggest || []; // Почему может быть undefined?
            data.text = this.text();

            return data;
        },

        // Вычисляем новый кит на основе данных в строке или кастомного текста
        parse: function(ctext) {
            var text = ctext || this.text();

            this.trailingSpace = text[text.length - 1] === ' ';
            newKit = this.parser(this.kit, text);

            return newKit;
        },

        // Проверяет соответствие кита текущей строке в инпуте, или кастомной строке
        invalidate: function(customText) {
            var kit = this.parse(customText);

            this.kit = kit;
        },

        // Окукливает токены если в конце стоит разделитель и они точно совпадают с первым сагестом
        brick: function(kit) {
            var sameText = true,
                text = this.text(),
                newKit = [];

            if (kit) {
                for (var i = 0 ; i < kit.length ; i++) {
                    var sToken = this.suggest && this.suggest[0] && this.suggest[0][i];
                    sameText = sameText && sToken && kit[i].text.toLowerCase() == sToken.text.toLowerCase();
                    newKit.push(sToken);
                }
            }

            if (sameText && text[text.length - 1] == this.delimiter) {
                return newKit;
            } else {
                return kit;
            }
        },

        // Выставляет класс текущности на кит сагеста номер index, и удаляет его с остальных
        markSuggest: function(index) {
            var suggestsItems = $('.' + this.params.suggestItemCls, this.params.root),
                currentCls = this.params.suggestItemCurrentCls;

            if (index === undefined) {
                index = this._activeSuggest;
            }

            suggestsItems.removeClass(currentCls); // Удаляем со всех сагестов класс текущности
            if (index >= 0) {
                suggestsItems.eq(index).addClass(currentCls); // Если индекс не отрицательный - добавляем класс на текущий кит сагеста
                this._activeSuggest = index;
                this.updateHint();
            }

            $(this.root).addClass(this.params.placeholderCls);

            this._activeSuggest = index;
        },

        // Возвращает нетокенные ошметки типа ", "
        getTail: function(kit) {
            var text = this.text(),
                kitText = [],
                tail;

            kit = kit || this.kit;

            if (kit) {
                for (var i = 0 ; i < kit.length ; i++) {
                    kitText.push(kit[i].text);
                }
            }
            kitText = kitText.join(this.delimiter + ' ');

            if (text.indexOf(kitText) == 0) {
                tail = text.substr(kitText.length, text.length);
            }

            return tail;
        },

        minimize: function() {
            $(this.root).removeClass(this.params.suggestCls);
        },

        dispose: function() {
            $(this.root).attr('data-surt-inited', 'disposed');
            $(this.root).off('surt');
            clearTimeout(this._upTimer);
        },

        trim: function(str) {
            if (String.prototype.trim) {
                return str.trim();
            } else {
                return str.replace(/^\s+|\s+$/g, '');
            }
        },

        // Возвращает true, если работа ведется в текстовом режиме
        textMode: function() {
            return this.inputNode.tagName == 'INPUT' || this.params.inputMode == 'text';
        }
    };

    surt.fn.constructor.prototype = surt.fn;

    $.fn.surt = surt;

    surt.version = '0.3.0';
})(this);
