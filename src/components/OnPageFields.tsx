import type { EditState, FormField, PageInfo } from '../lib/types';
import { transformPoint } from '../lib/utils';

export default function OnPageFields({
  fields,
  values,
  page,
  info,
  disabled,
  onChange,
}: {
  fields: FormField[];
  values: EditState['fields'];
  page: number;
  info: PageInfo;
  disabled: boolean;
  onChange: (name: string, value: string | boolean | string[]) => void;
}) {
  return (
    <div className="on-page-fields">
      {fields.flatMap(
        (field) =>
          field.widgets
            ?.filter((w) => w.page === page)
            .map((widget, index) => {
              const a = transformPoint(info.transform, widget.bounds[0], widget.bounds[1]);
              const b = transformPoint(info.transform, widget.bounds[2], widget.bounds[3]);
              const value = values[field.name] ?? field.value;
              const props = {
                'aria-label': `Form: ${field.name}${widget.option ? ` — ${widget.option}` : ''}`,
                disabled: disabled || field.readOnly,
                style: {
                  left: `${(Math.min(a[0], b[0]) / info.width) * 100}%`,
                  top: `${(Math.min(a[1], b[1]) / info.height) * 100}%`,
                  width: `${(Math.abs(a[0] - b[0]) / info.width) * 100}%`,
                  height: `${(Math.abs(a[1] - b[1]) / info.height) * 100}%`,
                },
              };
              const key = `${field.name}-${index}`;
              if (field.type === 'checkbox' || field.type === 'radio')
                return (
                  <input
                    key={key}
                    {...props}
                    type={field.type}
                    checked={field.type === 'checkbox' ? Boolean(value) : value === widget.option}
                    onChange={(e) =>
                      onChange(
                        field.name,
                        field.type === 'checkbox' ? e.target.checked : widget.option || '',
                      )
                    }
                  />
                );
              if (field.type === 'select')
                return (
                  <select
                    key={key}
                    {...props}
                    value={Array.isArray(value) ? value[0] || '' : String(value)}
                    onChange={(e) => onChange(field.name, e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {field.options?.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                );
              return field.multiline ? (
                <textarea
                  key={key}
                  {...props}
                  value={String(value)}
                  onChange={(e) => onChange(field.name, e.target.value)}
                />
              ) : (
                <input
                  key={key}
                  {...props}
                  value={String(value)}
                  onChange={(e) => onChange(field.name, e.target.value)}
                />
              );
            }) || [],
      )}
    </div>
  );
}
