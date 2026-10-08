/* Admin behaviour: Select2 autocomplete over server-side lookups, and delete confirmations. */
(function ($) {
  'use strict';

  // Every <select data-lookup="/admin/..."> becomes an autocomplete that queries the back-end as you type.
  $('select[data-lookup]').each(function () {
    var $el = $(this);
    $el.select2({
      theme: 'bootstrap-5',
      width: '100%',
      placeholder: $el.data('placeholder') || 'Start typing…',
      allowClear: !$el.prop('multiple'),
      closeOnSelect: !$el.prop('multiple'),
      minimumInputLength: Number($el.data('min-length')) || 3, // the back-end is only asked from 3 characters
      ajax: {
        url: $el.data('lookup'),
        dataType: 'json',
        delay: 300, // wait for a pause in typing before sending the request
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

  // <form data-confirm="Delete this?"> asks before submitting.
  $(document).on('submit', 'form[data-confirm]', function (event) {
    if (!window.confirm($(this).data('confirm'))) event.preventDefault();
  });
})(window.jQuery);
