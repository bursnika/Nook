(function ($) {
  'use strict';

  // select2 autocomplete for <select data-lookup>
  $('select[data-lookup]').each(function () {
    var $el = $(this);
    $el.select2({
      theme: 'bootstrap-5',
      width: '100%',
      placeholder: $el.data('placeholder') || 'Start typing…',
      allowClear: !$el.prop('multiple'),
      closeOnSelect: !$el.prop('multiple'),
      minimumInputLength: Number($el.data('min-length')) || 3,
      ajax: {
        url: $el.data('lookup'),
        dataType: 'json',
        delay: 300,
        cache: true,
        data: function (params) {
          return { q: params.term, page: params.page || 1 };
        },
        processResults: function (data, params) {
          params.page = params.page || 1;
          return { results: data.results, pagination: { more: data.more } };
        },
      },
      language: {
        inputTooShort: function (args) {
          return 'Type at least ' + (args.minimum - args.input.length) + ' more character(s)';
        },
        searching: function () {
          return 'Searching…';
        },
        noResults: function () {
          return 'Nothing found';
        },
      },
    });
  });

  $(document).on('submit', 'form[data-confirm]', function (event) {
    if (!window.confirm($(this).data('confirm'))) event.preventDefault();
  });

  // server renders utc, show it in local time
  $('time.local-time').each(function () {
    var date = new Date(this.getAttribute('datetime'));
    if (!isNaN(date.getTime())) {
      this.textContent = date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }
  });
})(window.jQuery);
